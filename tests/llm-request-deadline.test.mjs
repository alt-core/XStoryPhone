import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createStructuredOutputProvider } from '../src/worker/providers/structuredOutput.ts';
import { requestTypesafeSystemOne, resolveTypesafeConfig } from '../src/worker/providers/typesafe.ts';
import { createTalkRuleSelector } from '../src/worker/services/talkResolver.ts';

const request = { taskId:'deadline-test', instructions:'非公開の試験指示', input:{text:'非公開の試験入力'}, schema:{type:'object'} };
const ready = () => Response.json({choices:[{message:{content:'{"ok":true}'}}]});
function clock(t) {
  let now=1_000;
  const timers=new Set(), delays=[], logs=[];
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'setTimeout',(fn,ms)=>{const timer={fn,ms};timers.add(timer);delays.push(ms);return timer;});
  t.mock.method(globalThis,'clearTimeout',timer=>timers.delete(timer));
  t.mock.method(console,'log',line=>logs.push(JSON.parse(line)));
  const env={LLM_API_KEY:'非公開の試験キー',LLM_MODEL:'fixture',LLM_TIMEOUT_MS:'27000',LLM_ANALYTICS_ENABLED:'true',requestDeadlineMs:28_000};
  return {env,timers,delays,logs,advance(ms){now+=ms;},fire(timer){timers.delete(timer);timer.fn();}};
}
async function until(check) {
  for(let i=0;i<100;i++){if(check())return;await new Promise(setImmediate);}
  assert.fail('試験中の非同期待機に到達しませんでした');
}
const waitForAbort=signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('中断')),{once:true}));

test('5秒を超す応答を受け取り、後続の別providerも同じ残り時間を使う',async t=>{
  const c=clock(t);
  t.mock.method(globalThis,'fetch',async()=>{c.advance(6_000);return ready();});
  assert.equal((await createStructuredOutputProvider(c.env).completeJson(request)).ok,true);
  assert.equal((await createStructuredOutputProvider(c.env).completeJson({...request,operation:'match_extraction'})).ok,true);
  assert.deepEqual(c.delays,[27_000,21_000]);
  assert.equal(c.timers.size,0);
});

for(const receivingBody of [false,true]) test(`共有締切で${receivingBody?'本文受信':'接続待ち'}を中断し、残り時間のない再試行をしない`,async t=>{
  const c=clock(t);let calls=0,bodyStarted=false;
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>{
    calls++;
    if(!receivingBody)return waitForAbort(signal);
    return {ok:true,status:200,json(){bodyStarted=true;return waitForAbort(signal);}};
  });
  const pending=createStructuredOutputProvider(c.env).completeJson(request);
  await until(()=>calls===1&&(!receivingBody||bodyStarted));
  c.advance(27_000);c.fire([...c.timers][0]);
  assert.deepEqual(await pending,{ok:false,error:'provider_error'});
  assert.equal(calls,1);assert.equal(c.timers.size,0);
  assert.equal(c.logs[0].failureReason,'timeout');
  assert.equal(c.logs[0].attemptDetails[0].error,'timeout');
  assert.equal(c.logs[0].attemptDetails[0].httpStatus,receivingBody?200:undefined);
  const text=JSON.stringify(c.logs);
  for(const secret of ['非公開の試験キー','非公開の試験入力','非公開の試験指示'])assert.ok(!text.includes(secret));
});

test('429再試行の待ち時間も共有締切へ含め、HTTP statusを通常ログへ残す',async t=>{
  const c=clock(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;c.advance(1_000);return calls===1?new Response('',{status:429}):ready();});
  const pending=createStructuredOutputProvider(c.env).completeJson(request);
  await until(()=>[...c.timers].some(timer=>timer.ms===250));
  c.advance(250);c.fire([...c.timers].find(timer=>timer.ms===250));
  assert.equal((await pending).ok,true);
  assert.deepEqual(c.delays,[27_000,250,25_750]);
  assert.deepEqual(c.logs[0].attemptDetails.map(a=>a.httpStatus),[429,200]);
  assert.equal(calls,2);
});

test('期限が尽きた後の抽出やhookは通信せず、短いprofile上限は維持する',async t=>{
  const c=clock(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return ready();});
  assert.equal((await createStructuredOutputProvider(c.env).completeJson({...request,timeoutMs:5_000})).ok,true);
  assert.deepEqual(c.delays,[5_000]);
  c.advance(27_000);
  for(let i=0;i<2;i++)assert.deepEqual(await createStructuredOutputProvider(c.env).completeJson(request),{ok:false,error:'provider_error'});
  assert.equal(calls,1);
  assert.ok(c.logs.slice(1).every(log=>log.failureReason==='request_deadline'&&log.attempts===0));
});

test('並列の抽出標本も同じ時点で中断し、再試行待ちの余裕がなければ追加通信しない',async t=>{
  const c=clock(t);let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>{calls++;return waitForAbort(signal);});
  const provider=createStructuredOutputProvider(c.env);
  const pending=Promise.all([provider.completeJson(request),provider.completeJson(request)]);
  await until(()=>calls===2);
  c.advance(27_000);for(const timer of [...c.timers])c.fire(timer);
  assert.ok((await pending).every(result=>!result.ok));assert.equal(calls,2);
  c.env.requestDeadlineMs=Date.now()+100;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:503});});
  assert.equal((await createStructuredOutputProvider(c.env).completeJson(request)).httpStatus,503);
  assert.equal(calls,3);assert.equal(c.timers.size,0);
});

test('AWS handlerは入口からの残り時間を使い、要求間で締切を共有しない',async()=>{
  let now=1_000;const captured=[];
  const sandbox={exports:{},Date:{now:()=>now},process:{env:{TABLE_NAME:'fixture',LLM_TIMEOUT_MS:'27000'}},require(name){
    if(name==='@aws-sdk/client-dynamodb')return {DynamoDBClient:class {}};
    if(name==='./dynamoStore')return {DynamoStore:class {}};
    if(name==='../../server/app')return {createApp(dependencies){captured.push(dependencies);return dependencies;}};
    if(name==='hono/aws-lambda')return {handle:app=>async event=>{await event.wait;return app.config.llm.requestDeadlineMs;}};
    throw new Error(`未対応import: ${name}`);
  }};
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL('../src/platform/aws/handler.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
  let finish;const first=sandbox.exports.handler({wait:new Promise(resolve=>finish=resolve)},{getRemainingTimeInMillis:()=>30_000});
  now=2_000;
  assert.equal(await sandbox.exports.handler({},{getRemainingTimeInMillis:()=>8_000}),7_000);
  assert.equal(await sandbox.exports.handler({},{getRemainingTimeInMillis:()=>900_000}),29_000,'HTTP APIの30秒枠も超えない');
  finish();assert.equal(await first,28_000);
  assert.equal(captured[0].store,captured[1].store,'storeは共有する');
  assert.notEqual(captured[0].config.llm,captured[1].config.llm,'要求の設定は独立する');
});

test('Jevで使った時間を回付先LLMの待機から引き、期限後のJevも呼ばない',async t=>{
  const c=clock(t);let calls=0;
  const config=resolveTypesafeConfig({...c.env,TYPESAFE_API_KEY:'fixture'});
  assert.equal(config.ok,true);
  t.mock.method(globalThis,'fetch',async()=>{calls++;c.advance(4_000);return ready();});
  assert.equal((await requestTypesafeSystemOne(config,{})).ok,true);
  assert.equal((await createStructuredOutputProvider(c.env).completeJson(request)).ok,true);
  assert.deepEqual(c.delays,[10_000,23_000]);
  c.advance(19_000);
  assert.equal((await requestTypesafeSystemOne(config,{})).error,'provider_error');
  assert.equal(calls,2);
});

test('残り時間が少ないJevはその時点で中断し、10秒の試行を追加しない',async t=>{
  const c=clock(t);c.env.requestDeadlineMs=3_000;let calls=0;
  const config=resolveTypesafeConfig({...c.env,TYPESAFE_API_KEY:'fixture'});
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>{calls++;return waitForAbort(signal);});
  const pending=requestTypesafeSystemOne(config,{});
  await until(()=>calls===1);assert.deepEqual(c.delays,[2_000]);
  c.advance(2_000);c.fire([...c.timers][0]);
  assert.equal((await pending).error,'provider_error');assert.equal(calls,1);
  assert.equal(c.logs[0].failureReason,'timeout');
});

test('Jev不正応答の2回の再試行も共有締切から引き、枠が尽きたらLLMへ回さない',async t=>{
  const c=clock(t);let calls=0;
  const env={...c.env,LLM_TALK_SELECTOR:'typesafe',TYPESAFE_API_KEY:'fixture',TYPESAFE_LOW_CONFIDENCE_FALLBACK:'llm'};
  const provider={id:'fake',async completeJson(){assert.fail('不正応答や締切切れをLLMへ回さない');}};
  const selector=createTalkRuleSelector(env,provider,{talkId:'talk',kind:'sms',fromId:'start'});
  const input={playerInput:'非公開の入力',rules:[{id:'default',from:'start',isDefault:true,intent:'',criteria:'返事を待つ',mode:'stay'}],defaultRuleId:'default',recentMessages:[]};
  t.mock.method(globalThis,'fetch',async()=>{calls++;c.advance(8_000);return Response.json({answers:{}});});
  const pending=selector(input);
  for(let i=0;i<2;i++){
    await until(()=>[...c.timers].some(timer=>timer.ms===250));
    c.advance(250);c.fire([...c.timers].find(timer=>timer.ms===250));
  }
  assert.deepEqual(await pending,{ok:false,error:'provider_invalid'});
  assert.equal(calls,3);
  assert.deepEqual(c.delays,[10_000,250,10_000,250,10_000]);
  assert.equal(c.timers.size,0);

  // 初回の不正応答で残り250msなら、再試行待ちも後続通信も追加しない。
  env.requestDeadlineMs=Date.now()+8_250;
  const limited=createTalkRuleSelector(env,provider,{talkId:'talk',kind:'sms',fromId:'start'});
  assert.deepEqual(await limited(input),{ok:false,error:'provider_invalid'});
  assert.equal(calls,4);
  assert.equal(c.delays.at(-1),8_250);
  assert.equal(c.timers.size,0);
});

test('Jev不正応答の再試行待ちで締切を過ぎたら追加通信しない',async t=>{
  const c=clock(t);let calls=0;
  const config=resolveTypesafeConfig({...c.env,TYPESAFE_API_KEY:'fixture'});
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({answers:{}});});
  const pending=requestTypesafeSystemOne(config,{}, {},undefined,()=> 'invalid_shape');
  await until(()=>[...c.timers].some(timer=>timer.ms===250));
  c.advance(27_000);c.fire([...c.timers].find(timer=>timer.ms===250));
  assert.deepEqual(await pending,{ok:false,error:'provider_error'});
  assert.equal(calls,1);
  assert.equal(c.timers.size,0);
  assert.equal(c.logs[0].failureReason,'request_deadline');
});
