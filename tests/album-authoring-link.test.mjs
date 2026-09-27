import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { parseTsv } from "../scripts/lib/tsv-utils.mjs";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { scenarioForParts } from "../src/worker/scenarioParts.ts";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";
import { buildStaticScenario, staticPartLocators } from "../scripts/lib/static-scenario.mjs";
import { createStaticPlayerExecution } from "../src/static/playerExecution.ts";
import { createPartSession } from "../src/worker/partSession.ts";
import { createPlayerOperations } from "../src/server/playerApp.ts";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { encodeBrowserProgress } from "../src/server/browserProgress.ts";
import { auditStaticDistribution } from "../scripts/lib/static-audit.mjs";

// 対応を生成済みfixtureへ書き足さず、content空欄の実TSVから製品の生成器を通す。
function authoringFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-album-authoring-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync("scenario/demo", directory, { recursive: true });
  function edit(table, change) {
    const file = path.join(directory, "authoring", `${table}.tsv`);
    const matrix = parseTsv(fs.readFileSync(file, "utf8"));
    const headers = matrix[0];
    const rows = matrix.slice(1).map(row => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ""])));
    change(rows);
    const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    fs.writeFileSync(file, [headers, ...rows.map(row => headers.map(key => row[key] ?? ""))].map(row => row.map(cell).join("\t")).join("\n") + "\n");
  }
  edit("home_items", rows => rows.forEach(row => { row.initial = "normal"; row.cond = ""; }));
  edit("project_constants", rows => { rows.find(row => row.key === "chat_auth.cond").value = "false"; });
  for (const type of ["image", "audio", "video"]) {
    edit("attachments", rows => rows.push({ id: `fixture_${type}`, type, asset: `/fixture/${type}.media` }));
    edit("photo_items", rows => rows.push({
      id: `fixture_${type}_item`, initial: "hidden", title: `${type}の資料`,
      image: type === "image" ? "fixture_image" : type === "audio" ? "fixture_poster" : "",
      audio: type === "audio" ? "fixture_audio" : "", video: type === "video" ? "fixture_video" : ""
    }));
    for (const kind of ["sms", "chat"]) {
      const talkId = `fixture_${kind}_${type}`;
      edit(kind === "sms" ? "message_items" : "chat_items", rows => rows.push({ id: talkId, name: "受信箱", start: "received" }));
      edit("talk_blocks", rows => rows.push({ comment: `*${talkId}` }, { comment: "received" }, { sender: "guide", attachment: `fixture_${type}`, time: "2030-01-01T12:00:00+09:00" }));
    }
  }
  edit("attachments", rows => rows.push({ id: "fixture_poster", type: "image", asset: "/fixture/poster.svg" }));
  function build() {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", 'import {loadAndValidateScenario} from "./scripts/scenario-lib.mjs"; console.log(JSON.stringify(loadAndValidateScenario()));'], {
      encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: directory }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  return { directory, edit, build };
}

function lockedImageFixture(t, sameTarget = false) {
  const f = authoringFixture(t);
  const contentId = sameTarget ? "fixture_image_item" : "fixture_file";
  f.edit("attachments", rows => Object.assign(rows.find(item => item.id === "fixture_image"), {
    lock: "password", content: contentId, title: "鍵付き画像", body: "解錠後の説明"
  }));
  f.edit("passwords", rows => rows.push({ content: contentId, password: '"0420"' }));
  return { ...f, contentId };
}

function unlockedNavigation(state, message) {
  const app = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
    "applyAttachmentState", "isLockedAttachment", "albumMediaContentId", "isAlbumMediaAttachment"
  ], { apps: state.visibleDeviceState.apps, sendablePhotos: state.visibleDeviceState.photos.filter(item => !item.corrupted) });
  const merged = app.applyAttachmentState(message,
    new Map(state.contentStates.map(item => [item.contentId, item.state])),
    new Map(state.unlockedAttachments.map(item => [item.contentId, item])));
  return { message: merged, target: app.albumMediaContentId(merged.attachment) };
}

test("実TSVの鍵付き画像・音声・動画・文書を、SMS/chatの同じ解錠経路で表示する", async t => {
  const f = authoringFixture(t);
  for (const type of ["image","audio","video","document"]) {
    f.edit("attachments", rows => {
      if (type === "document") rows.push({id:"fixture_document",type,body:"秘密の文書本文"});
      Object.assign(rows.find(row=>row.id===`fixture_${type}`), {content:`file_${type}`,lock:"password",title:"添付",body:`${type}の説明`,...(type==="audio"?{poster:"fixture_poster"}:{})});
    });
    f.edit("passwords", rows=>rows.push({content:`file_${type}`,password:'"0420"'}));
    if (type === "document") for (const kind of ["sms","chat"]) {
      f.edit(kind === "sms" ? "message_items" : "chat_items",rows=>rows.push({id:`fixture_${kind}_document`,name:"文書",start:"received"}));
      f.edit("talk_blocks",rows=>rows.push({comment:`*fixture_${kind}_document`},{comment:"received"},{sender:"guide",attachment:"fixture_document",time:"2030-01-01T12:00:00+09:00"}));
    }
  }
  const {worker} = f.build();
  worker.playerMode="browser";
  worker.hooks=[{event:"content_unlocked",target:"*",handler:"unlock",cond:"",part:"base"}];
  for(const kind of ["sms","chat"]) for(const type of ["image","audio","video","document"]) {
    let reject=true;
    const parts=createPartSession(worker,{unlock(context){if(reject)context.form.deny("not_now");}});
    const runtime=parts.runtime;
    const ops=createPlayerOperations(runtime,parts.hooks,createGeneratedAudioRuntime(runtime),undefined,parts);
    const talk=worker.talks.find(item=>item.id===`fixture_${kind}_${type}`);
    const initial=runtime.initializeTalkState(talk,"turn",worker.stateVariables);
    let state=runtime.createInitialPlayerState();
    state.talks[talk.id]=initial.state;
    state=runtime.revealTalkMessages(state,talk.id,initial.messages);
    const message=runtime.publicTalkMessage(initial.messages[0]);
    const secret="local-locked-media-test";
    let token=await encodeBrowserProgress(secret,worker.project.id,{id:"fixture",state,stateVersion:0});
    const request=async password=>{
      const result=await ops.execute("POST /api/content/unlock",{hostname:"localhost",body:{progressToken:token,contentId:message.attachment.contentId,password}},
        {store:{},config:{appEnv:"development",browserStateSecret:secret,llm:{}}});
      token=result.payload.playerState?.progressToken??token;
      return result;
    };
    assert.equal((await request("wrong")).status,400);
    const denied=await request("0420");
    assert.equal(denied.status,422);
    assert.ok(!JSON.stringify(denied.payload).includes(`/fixture/${type}.media`));
    reject=false;
    const accepted=await request("0420");
    assert.equal(accepted.status,200,`${kind}/${type}: ${JSON.stringify(accepted)}`);
    const view=accepted.payload.playerState;
    const hydrated=unlockedNavigation(view,message);
    assert.equal(hydrated.message.attachment.locked,false);
    assert.equal(hydrated.message.attachment.unlockedBody,`${type}の説明`);
    if(type==="document") {
      assert.equal(hydrated.message.attachment.unlockedMedia,undefined);
    } else {
      const media=hydrated.message.attachment.unlockedMedia;
      assert.equal(media.kind,type);
      assert.equal(media[`${type}Url`],`/fixture/${type}.media`);
      assert.equal(media.attachmentId,worker.publicIds.attachment[`fixture_${type}`]);
      assert.equal(hydrated.target,worker.publicIds.content[`fixture_${type}_item`]);
      if(type==="audio")assert.equal(media.imageUrl,"/fixture/poster.svg");
    }
    if(kind==="chat") {
      const client=componentFunctionHarness(new URL("../src/client/App.svelte",import.meta.url),["mergeChatMessages","applyAttachmentState","isLockedAttachment"],{
        talkMessageDisplayTime:message=>message.sentAt,photoAttachmentFromBody:()=>null,shareAttachmentFromBody:()=>null,talkMessageBody:body=>body
      });
      const threads=client.mergeChatMessages([{id:talk.publicId,messages:[]}],{...view,chatMessages:[message]},[],[],[],[]);
      assert.equal(threads[0].messages[0].attachment.locked,false,"チャットの合成でも開錠状態を反映");
    }
  }
});

test("開錠対象だけbaseにあっても未取得の添付本文を開錠済みとして保存しない", t => {
  const f = lockedImageFixture(t);
  f.edit("attachments", rows => {
    const [attachment]=rows.splice(rows.findIndex(row=>row.id==="fixture_image"),1);
    attachment.content="welcome_note";
    rows.push({comment:"#later"},attachment);
  });
  f.edit("passwords",rows=>{rows.find(row=>row.content===f.contentId).content="welcome_note";});
  const {worker}=f.build();
  const runtime=createScenarioRuntime(scenarioForParts(worker,["base"]));
  const state=runtime.createInitialPlayerState();
  state.unlockedContentIds=["welcome_note"];
  assert.throws(()=>runtime.validatePartState(state),/開錠する添付.*未取得/u);
  createScenarioRuntime(worker).validatePartState(state);
});

test("鍵付き添付のkind省略を旧形式として補完しない", () => {
  for (const file of ["App.svelte", "apps/MessagesApp.svelte"]) {
    const view = componentFunctionHarness(new URL(`../src/client/${file}`, import.meta.url), ["isLockedAttachment"]);
    assert.equal(view.isLockedAttachment({ contentId: "file", locked: true }), false);
    assert.equal(view.isLockedAttachment({ kind: "locked", contentId: "file", locked: true }), true);
  }
});

test("鍵付き画像の対応は明示IDだけで決まり、同じURL・表示条件・partから選ばない", t => {
  const f = lockedImageFixture(t);
  assert.equal(f.build().worker.attachments.find(item => item.id === "fixture_image").albumContentId, "fixture_image_item");
  f.edit("attachments", rows => rows.push({ id: "same_url", type: "image", asset: "/fixture/image.media" }));
  f.edit("photo_items", rows => {
    rows.find(item => item.id === "fixture_image_item").image = "same_url";
  });
  assert.equal(f.build().worker.attachments.find(item => item.id === "fixture_image").albumContentId, undefined, "URL一致で結ばない");
  f.edit("photo_items", rows => {
    rows.find(item => item.id === "fixture_image_item").image = "fixture_image";
    rows.push({ comment: "#later" }, { id: "second_target", image: "fixture_image", initial: "hidden", title: "別の項目", cond: "false" });
  });
  assert.equal(f.build().worker.attachments.find(item => item.id === "fixture_image").albumContentId, undefined, "取得前・条件不成立の候補も含めて曖昧さを判定する");
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_image").content = "fixture_image_item"; });
  f.edit("passwords", rows => { rows.find(item => item.content === f.contentId).content = "fixture_image_item"; });
  assert.equal(f.build().worker.attachments.find(item => item.id === "fixture_image").albumContentId, "fixture_image_item", "明示contentを優先する");
});

for (const mode of ["server", "browser"]) for (const sameTarget of [false, true]) {
  test(`${mode}: 鍵付き画像を正答後だけ登録し、再取得後も同じアルバムへ開く（同一ID=${sameTarget}）`, async t => {
    const f = lockedImageFixture(t, sameTarget);
    // 検索先がchatでも、SMSで表示済みの添付を開錠できる。
    f.edit("attachments", rows => Object.assign(rows.find(item => item.id === "fixture_image"), { search_app: "chat", search: "確認資料" }));
    const { worker } = f.build();
    assert.equal(worker.contents.find(item => item.id === f.contentId).appId, sameTarget ? "photos" : "messages");
    worker.playerMode = mode;
    worker.hooks = [{ event: "content_unlocked", target: f.contentId, handler: "unlock_check", cond: "", part: "base", order: 0, needsAi: false }];
    let reject = true;
    const parts = createPartSession(worker, { unlock_check(context) { if (reject) context.form.deny("not_now"); } });
    const runtime = parts.runtime;
    const operations = createPlayerOperations(runtime, parts.hooks, createGeneratedAudioRuntime(runtime), undefined, parts);
    const talk = worker.talks.find(item => item.id === "fixture_sms_image");
    const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
    let state = runtime.createInitialPlayerState();
    state.talks[talk.id] = initial.state;
    state = runtime.revealTalkMessages(state, talk.id, initial.messages);
    assert.ok(runtime.searchScenario("確認資料", state).some(item => item.appId === "chat"));
    const message = runtime.publicTalkMessage(initial.messages[0]);
    const photoId = worker.publicIds.content.fixture_image_item;
    const contentId = worker.publicIds.content[f.contentId];
    let player = { id: "locked-image-test", state, stateVersion: 0 };
    const store = {
      async playerForSession() { return structuredClone(player); },
      async savePlayer(_before, state) { player = { ...player, state: structuredClone(state), stateVersion: player.stateVersion + 1 }; return true; },
      async dueScheduledEvents() { return []; }, async nextScheduledWakeAt() { return null; }, async generatedAudioJobs() { return []; }
    };
    const secret = "locked-image-local-test";
    const dependencies = { store, config: { appEnv: "development", browserStateSecret: secret, llm: {} } };
    let token = await encodeBrowserProgress(secret, worker.project.id, player);
    const request = async (route, body = {}) => {
      const result = await operations.execute(`POST ${route}`, {
        hostname: "localhost", authorization: "Bearer fixture", body: { ...body, ...(mode === "browser" ? { progressToken: token } : {}) }
      }, dependencies);
      token = result.payload.playerState?.progressToken ?? token;
      return result;
    };
    const observed = await request("/api/content/media-observed", { appId: "messages", contentId: talk.publicId, mediaContentIds: [photoId] });
    assert.equal(observed.status, 200);
    assert.ok(!JSON.stringify(observed.payload.playerState).includes("/fixture/image.media"), "表示済み鍵付き添付から正答前に画像を漏らさない");
    assert.equal(unlockedNavigation(observed.payload.playerState, message).target, "");
    const wrong = await request("/api/content/unlock", { contentId, password: "wrong" });
    assert.equal(wrong.status, 400);
    const denied = await request("/api/content/unlock", { contentId, password: "0420" });
    assert.equal(denied.status, 422);
    assert.ok(!JSON.stringify(denied.payload.playerState).includes("/fixture/image.media"), "hookの拒否時はアルバム登録も確定しない");
    reject = false;
    const unlocked = await request("/api/content/unlock", { contentId, password: "0420" });
    assert.equal(unlocked.status, 200, JSON.stringify(unlocked));
    const after = unlocked.payload.playerState;
    assert.ok(after.visibleDeviceState.photos.some(item => item.contentId === photoId && !item.corrupted));
    assert.equal(after.visibleDeviceState.photos.find(item => item.contentId === photoId).attachmentId, worker.publicIds.attachment.fixture_image,
      "アルバム側でも添付IDの対応を失わず、再送した画像のタップ先も維持する");
    const navigation = unlockedNavigation(after, message);
    assert.equal(navigation.target, photoId);
    assert.equal(navigation.message.attachment.unlockedBody, "解錠後の説明");
    assert.equal(navigation.message.attachment.kind, "locked", "開封済みファイル表示を通常画像に置換しない");
    const opened = await request("/api/content/opened", { appId: "photos", contentId: navigation.target });
    assert.equal(opened.status, 200, JSON.stringify(opened));
    const again = await request("/api/content/unlock", { contentId, password: "0420" });
    assert.equal(again.status, 200);
    assert.equal(again.payload.playerState.visibleDeviceState.photos.filter(item => item.contentId === photoId).length, 1);
    assert.equal(unlockedNavigation(again.payload.playerState, message).target, photoId);
  });
}

test("解錠後のアルバム登録でもcond・親アプリ・未取得partを迂回しない", async t => {
  const f = lockedImageFixture(t);
  const { worker } = f.build();
  const photo = worker.contents.find(item => item.id === "fixture_image_item");
  photo.cond = "session_started";
  const app = worker.apps.find(item => item.id === "photos");
  app.initialState = "repairable";
  const runtime = createScenarioRuntime(worker);
  const state = runtime.createInitialPlayerState();
  state.unlockedContentIds.push(f.contentId);
  state.repairedContentIds.push(...runtime.unlockedAlbumContentIds(f.contentId));
  const message = { attachment: { kind: "locked", locked: true, contentId: worker.publicIds.content[f.contentId] } };
  for (const [condition, parent, expected] of [[false, false, ""], [true, false, ""], [false, true, ""], [true, true, photo.publicId]]) {
    state.stateValues.session_started = condition;
    state.repairedAppIds = parent ? ["photos"] : [];
    const view = await runtime.publicPlayerState(state, 1);
    assert.equal(unlockedNavigation(view, message).target, expected);
  }
  photo.part = "later";
  photo.initialState = "repairable";
  const base = createScenarioRuntime(scenarioForParts(worker, ["base"]));
  assert.deepEqual(base.unlockedAlbumContentIds(f.contentId), [], "未取得partの破損枠を登録しない");
  const view = await base.publicPlayerState(state, 2);
  assert.equal(unlockedNavigation(view, message).target, "");
  assert.equal(view.unlockedAttachments.find(item => item.contentId === message.attachment.contentId).media?.albumContentId, undefined);
});

test("鍵付き画像のタップは既存のスクロール保存とアルバム遷移を使う", () => {
  const calls = [];
  const attachment = { kind: "locked", locked: false, unlockedMedia: {kind: "image", imageUrl: "/fixture/image.media", albumContentId: "photo"} };
  const component = componentFunctionHarness(new URL("../src/client/apps/MessagesApp.svelte", import.meta.url), ["openAlbumMedia"], {
    rememberHistoryScrollForLink: () => calls.push("scroll"), onOpenAlbumMedia: item => calls.push(item)
  });
  component.openAlbumMedia(attachment);
  assert.deepEqual(calls, ["scroll", attachment]);
  const source = fs.readFileSync("src/client/apps/LockedAttachmentContents.svelte", "utf8");
  assert.match(source, /TalkMediaAttachment media=\{attachment.unlockedMedia\}/u);
  assert.match(source, /\{onOpenAlbum\}/u);
});

test("staticの鍵付き画像は正答によるpart取得後にだけ登録される", async t => {
  const f = lockedImageFixture(t);
  f.edit("project_constants", rows => { rows.find(item => item.key === "player.mode").value = "static"; });
  for (const [table, id] of [["attachments", "fixture_image"], ["photo_items", "fixture_image_item"]]) {
    f.edit(table, rows => {
      const [row] = rows.splice(rows.findIndex(item => item.id === id), 1);
      rows.push({ comment: "#protected" }, row);
    });
  }
  f.edit("passwords", rows => { rows.find(item => item.content === f.contentId).load_part = "protected"; });
  const scenario = f.build();
  const outputDir = path.join(f.directory, "output");
  fs.mkdirSync(outputDir);
  staticPartLocators(f.directory, scenario.worker.project.id, scenario.worker.parts, true);
  const manifest = await buildStaticScenario({ root: f.directory, outputDir, scenario });
  const base = fs.readFileSync(path.join(outputDir, manifest.base), "utf8");
  assert.ok(!base.includes("/fixture/image.media"));
  // 配布定義の境界監査。クライアントbundle自体は通常のビルド検証に任せる。
  fs.mkdirSync(path.join(outputDir, "assets"));
  fs.writeFileSync(path.join(outputDir, "index.html"), "<html></html>");
  assert.deepEqual(auditStaticDistribution(outputDir, scenario.worker, scenario.hookScripts), []);
  const origin = "https://fixture.invalid/";
  const requests = [];
  const execution = createStaticPlayerExecution({
    projectId: scenario.worker.project.id, clientRevision: scenario.worker.clientRevision,
    entryUrl: origin + "static-entry.json", storage: { mode: "memory", prefix: "locked-image-test" },
    fetch: async url => {
      assert.ok(url.startsWith(origin));
      requests.push(url);
      return new Response(fs.readFileSync(path.join(outputDir, url.slice(origin.length))), { headers: { "content-type": "application/json" } });
    },
    module: async url => import(pathToFileURL(path.join(outputDir, url.slice(origin.length))).href)
  });
  await execution.initialize();
  const post = async (route, body = {}) => {
    const response = await execution.request(route, { method: "POST", body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const initial = await post("/api/session/start");
  assert.equal(initial.status, 200);
  assert.ok(!JSON.stringify(initial).includes("/fixture/image.media"));
  const contentId = scenario.worker.publicIds.content[f.contentId];
  const count = requests.length;
  assert.equal((await post("/api/content/unlock", { contentId, password: "wrong" })).status, 400);
  assert.equal(requests.length, count, "誤答は後partを取得しない");
  const result = await post("/api/content/unlock", { contentId, password: "0420" });
  assert.equal(result.status, 200, result.error);
  const photoId = scenario.worker.publicIds.content.fixture_image_item;
  const navigation = unlockedNavigation(result.playerState, { attachment: { kind: "locked", contentId, locked: true } });
  assert.equal(navigation.target, photoId);
  assert.equal((await post("/api/content/opened", { appId: "photos", contentId: photoId })).status, 200);
});

test("一意な主メディアの行先はcontentを上書きせず生成し、明示時と同じ添付になる", t => {
  const f = authoringFixture(t);
  const inferred = f.build();
  for (const type of ["image", "audio", "video"]) {
    const attachment = inferred.worker.attachments.find(item => item.id === `fixture_${type}`);
    assert.equal(attachment.content, undefined);
    assert.equal(attachment.albumContentId, `fixture_${type}_item`);
  }
  assert.equal(inferred.worker.attachments.find(item => item.id === "fixture_poster").content, undefined, "副素材への対応拡張は混ぜない");
  f.edit("attachments", rows => {
    for (const type of ["image", "audio", "video"]) rows.find(item => item.id === `fixture_${type}`).content = `fixture_${type}_item`;
  });
  const explicit = f.build();
  const implicitRuntime = createScenarioRuntime(inferred.worker);
  const explicitRuntime = createScenarioRuntime(explicit.worker);
  for (const type of ["image", "audio", "video"]) assert.deepEqual(implicitRuntime.resolveTalkAttachment(`fixture_${type}`), explicitRuntime.resolveTalkAttachment(`fixture_${type}`));
  assert.deepEqual(inferred.worker.albumMediaAttachmentLinks, explicit.worker.albumMediaAttachmentLinks);
});

test("関連contentがメモでもアルバム行先・露出・観測・タップを独立して扱う", async t => {
  const f = authoringFixture(t);
  f.edit("note_items", rows => rows.push({ id: "fixture_related_note", title: "資料", body: "本文" }));
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_image").content = "fixture_related_note"; });
  const { worker } = f.build();
  const runtime = createScenarioRuntime(worker);
  const definition = worker.attachments.find(item => item.id === "fixture_image");
  assert.equal(definition.content, "fixture_related_note");
  assert.equal(definition.albumContentId, "fixture_image_item");
  const talk = worker.talks.find(item => item.id === "fixture_sms_image");
  const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
  const state = runtime.revealTalkMessages(runtime.createInitialPlayerState(), talk.id, initial.messages);
  state.talks[talk.id] = initial.state;
  const message = runtime.publicTalkMessage(initial.messages[0]);
  assert.equal(message.attachment.contentId, worker.publicIds.content.fixture_related_note);
  assert.equal(message.attachment.albumContentId, worker.publicIds.content.fixture_image_item);
  const collector = componentFunctionHarness(new URL("../src/client/apps/MessagesApp.svelte", import.meta.url), ["mediaAttachmentContentIds", "isMediaAttachment"]);
  const observed = collector.mediaAttachmentContentIds([message]);
  assert.deepEqual([...observed], [message.attachment.albumContentId]);
  assert.deepEqual(runtime.observedAlbumMediaContentIds(talk, state, [message.attachment.contentId]), []);
  state.repairedContentIds.push(...runtime.observedAlbumMediaContentIds(talk, state, observed));
  const photos = (await runtime.publicPlayerState(state, 1)).visibleDeviceState.photos.filter(item => !item.corrupted);
  const navigation = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment"], { apps: [{ id: "photos", available: true }], sendablePhotos: photos });
  assert.equal(navigation.albumMediaContentId(message.attachment), worker.publicIds.content.fixture_image_item);
});

test("素材の本体参照が複数なら警告し、利用可能な先頭項目を勝手に選ばない", async t => {
  const f = authoringFixture(t);
  f.edit("photo_items", rows => { rows.find(item => item.id === "fixture_image_item").initial = "normal"; rows.push({ id: "second_item", image: "fixture_image", title: "別項目", initial: "normal" }); });
  const { worker, authoringWarnings } = f.build();
  assert.ok(authoringWarnings.some(text => text.includes("fixture_image") && text.includes("複数")));
  const runtime = createScenarioRuntime(worker);
  const talk = worker.talks.find(item => item.id === "fixture_sms_image");
  const message = runtime.publicTalkMessage(runtime.initializeTalkState(talk, "turn", worker.stateVariables).messages[0]);
  assert.equal(message.attachment.albumContentId, undefined);
  const photos = (await runtime.publicPlayerState(runtime.createInitialPlayerState(), 0)).visibleDeviceState.photos.filter(item => !item.corrupted);
  const navigation = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment"], { apps: [{ id: "photos", available: true }], sendablePhotos: photos });
  assert.equal(navigation.albumMediaContentId(message.attachment), "");
});

test("通常添付は明示したアルバム項目を開き、表示不能でも同じ素材の別項目へ差し替えない", async t => {
  const f = authoringFixture(t);
  f.edit("photo_items", rows => {
    rows.find(item => item.id === "fixture_image_item").initial = "normal";
    rows.push({ id: "fixture_second", image: "fixture_image", initial: "normal", title: "別の項目" });
  });
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_image").content = "fixture_second"; });
  const { worker } = f.build();
  const runtime = createScenarioRuntime(worker);
  const state = runtime.createInitialPlayerState();
  const talk = worker.talks.find(item => item.id === "fixture_sms_image");
  const attachment = runtime.publicTalkMessage(runtime.initializeTalkState(talk, "turn", worker.stateVariables).messages[0]).attachment;
  const target = worker.contents.find(item => item.id === "fixture_second");
  const view = async () => componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment"], {
    apps: [{ id: "photos", available: true }], sendablePhotos: (await runtime.publicPlayerState(state, 0)).visibleDeviceState.photos.filter(item => !item.corrupted)
  });
  assert.equal((await view()).albumMediaContentId(attachment), target.publicId);
  target.cond = "false";
  assert.equal((await view()).albumMediaContentId(attachment), "", "Aが表示されていても明示したBをAへ変えない");
  target.cond = "";
  target.initialState = "repairable";
  assert.equal((await view()).albumMediaContentId(attachment), "", "破損枠はタップ先にしない");
});

test("表紙画像だけでは疑似動画を登録・遷移せず、画像＋音声の添付は一体で扱う", async t => {
  const f = authoringFixture(t);
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_audio").poster = "fixture_poster"; });
  f.edit("talk_blocks", rows => rows.filter(item => item.attachment === "fixture_image").forEach(item => { item.attachment = "fixture_poster"; }));
  const { worker } = f.build();
  const runtime = createScenarioRuntime(worker);
  const photoId = worker.publicIds.content.fixture_audio_item;
  assert.equal(worker.attachments.find(item => item.id === "fixture_poster").content, undefined);
  for (const kind of ["sms", "chat"]) {
    const imageTalk = worker.talks.find(item => item.id === `fixture_${kind}_image`);
    const imageInitial = runtime.initializeTalkState(imageTalk, "image-turn", worker.stateVariables);
    const imageState = runtime.revealTalkMessages(runtime.createInitialPlayerState(), imageTalk.id, imageInitial.messages);
    assert.deepEqual(runtime.observedAlbumMediaContentIds(imageTalk, imageState, [photoId]), [], "表紙から動画を登録しない");
    imageState.repairedContentIds.push("fixture_audio_item");
    const availablePhotos = (await runtime.publicPlayerState(imageState, 0)).visibleDeviceState.photos.filter(item => !item.corrupted);
    const availableNavigation = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment"], { apps: [{ id: "photos", available: true }], sendablePhotos: availablePhotos });
    const image = runtime.publicTalkMessage(imageInitial.messages[0]).attachment;
    assert.equal(availableNavigation.albumMediaContentId(image), "", "動画が利用可能でも表紙だけから移動しない");
    assert.equal(availableNavigation.albumMediaContentId({ ...image, contentId: photoId }), "", "動画IDだけを画像へ付けても移動しない");

    const talk = worker.talks.find(item => item.id === `fixture_${kind}_audio`);
    const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
    const state = runtime.revealTalkMessages(runtime.createInitialPlayerState(), talk.id, initial.messages);
    state.talks[talk.id] = initial.state;
    const message = runtime.publicTalkMessage(initial.messages[0]);
    state.repairedContentIds.push(...runtime.observedAlbumMediaContentIds(talk, state, [message.attachment.contentId]));
    const photos = (await runtime.publicPlayerState(state, 0)).visibleDeviceState.photos.filter(item => !item.corrupted);
    const photo = photos.find(item => item.contentId === photoId);
    assert.equal(photo.mediaKind, "still_video");
    assert.equal(message.attachment.kind, "audio");
    assert.equal(message.attachment.imageUrl, photo.imageUrl);
    assert.equal(message.attachment.audioUrl, photo.audioUrl);
    const navigation = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment", "photoAttachmentFromBody", "photoMessagePattern"], { apps: [{ id: "photos", available: true }], sendablePhotos: photos });
    assert.equal(navigation.albumMediaContentId(message.attachment), photoId);
    const forwarded = navigation.photoAttachmentFromBody(`photo:${photoId}`, photos);
    assert.equal(forwarded.kind, "audio");
    assert.equal(forwarded.imageUrl, photo.imageUrl);
    assert.equal(forwarded.audioUrl, photo.audioUrl);
    assert.equal(navigation.albumMediaContentId(forwarded), photoId);
  }
});

for (const media of ["audio", "video"]) test(`表紙画像のcontentを${media}の動画へ結び付ける誤記は制作時に拒否する`, t => {
  const f = authoringFixture(t);
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_poster").content = `fixture_${media}_item`; });
  const result = spawnSync(process.execPath, ["scripts/scenario-validate.mjs"], { encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: f.directory } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /表紙画像だけを対応させず/u);
});

test("生成した対応がSMS/chatの表示観測からアルバム登録・タップ先までつながる", async t => {
  const f = authoringFixture(t);
  f.edit("photo_items", rows => { rows.find(item => item.id === "fixture_audio_item").initial = "repairable"; });
  const { worker } = f.build();
  const runtime = createScenarioRuntime(worker);
  for (const kind of ["sms", "chat"]) for (const type of ["image", "audio", "video"]) {
    const talk = worker.talks.find(item => item.id === `fixture_${kind}_${type}`);
    const photo = worker.contents.find(item => item.id === `fixture_${type}_item`);
    let state = runtime.createInitialPlayerState();
    const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
    state.talks[talk.id] = initial.state;
    const publicMessage = runtime.publicTalkMessage(initial.messages[0]);
    assert.equal(publicMessage.attachment.contentId, photo.publicId);
    const view = componentFunctionHarness(new URL(`../src/client/apps/${kind === "sms" ? "MessagesApp" : "ChatApp"}.svelte`, import.meta.url), [
      "mediaAttachmentContentIds", "isMediaAttachment"
    ]);
    const observedIds = view.mediaAttachmentContentIds([publicMessage]);
    assert.equal(observedIds[0], photo.publicId);
    assert.deepEqual(runtime.observedAlbumMediaContentIds(talk, state, observedIds), [], "未露出のID指定では追加しない");
    state = runtime.revealTalkMessages(state, talk.id, initial.messages);
    assert.deepEqual(runtime.observedAlbumMediaContentIds(talk, state, []), [], "実際の表示観測より先に追加しない");
    const before = await runtime.publicPlayerState(state, 0);
    const beforePhoto = before.visibleDeviceState.photos.find(item => item.contentId === photo.publicId);
    assert.ok(!beforePhoto || beforePhoto.corrupted);
    const additions = runtime.observedAlbumMediaContentIds(talk, state, observedIds);
    assert.deepEqual(additions, [photo.id]);
    state.repairedContentIds.push(...additions);
    const after = await runtime.publicPlayerState(state, 1);
    const restored = after.visibleDeviceState.photos.find(item => item.contentId === photo.publicId);
    assert.ok(restored && !restored.corrupted);
    assert.equal(restored.attachmentId, publicMessage.attachment.attachmentId);
    const navigation = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["albumMediaContentId", "isAlbumMediaAttachment"], {
      apps: [{ id: "photos", available: true }], sendablePhotos: after.visibleDeviceState.photos.filter(item => !item.corrupted)
    });
    assert.equal(navigation.albumMediaContentId(publicMessage.attachment), photo.publicId);
    assert.deepEqual(runtime.observedAlbumMediaContentIds(talk, state, observedIds), [], "再観測で重複追加しない");
    state.stateValues.session_started = true;
    assert.equal(runtime.resolveTalkAttachment(`fixture_${type}`).contentId, photo.id, "状態変更で対応先を選び直さない");
  }
});

test("複数参照は選択・拒否せず、明示指定と鍵付き添付を保つ", t => {
  const f = authoringFixture(t);
  f.edit("photo_items", rows => rows.push({ id: "fixture_shared", image: "fixture_image", title: "共有素材の別項目" }));
  const duplicate = f.build();
  assert.equal(duplicate.worker.attachments.find(item => item.id === "fixture_image").content, undefined);
  f.edit("attachments", rows => { rows.find(item => item.id === "fixture_image").content = "fixture_shared"; });
  assert.equal(f.build().worker.attachments.find(item => item.id === "fixture_image").content, "fixture_shared");
  f.edit("attachments", rows => { const audio = rows.find(item => item.id === "fixture_audio"); audio.lock = "password"; });
  // passwordの対象まで補完して、作者の不正な指定を別の意味へ変えない。
  const invalid = spawnSync(process.execPath, ["scripts/scenario-validate.mjs"], {
    encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: f.directory }
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /password lock/u);
  const locked = duplicate.worker.attachments.find(item => item.lock === "password");
  assert.ok(locked.content);
  assert.equal(createScenarioRuntime(duplicate.worker).resolveTalkAttachment(locked.id).kind, "locked");
});

test("補完した添付検索でも露出・表示条件・親アプリの制約を維持する", async t => {
  const f = authoringFixture(t);
  f.edit("attachments", rows => Object.assign(rows.find(item => item.id === "fixture_image"), { search: "確認資料", search_app: "messages" }));
  f.edit("photo_items", rows => { rows.find(item => item.id === "fixture_image_item").cond = "session_started"; });
  f.edit("home_items", rows => { rows.find(item => item.id === "photos").initial = "repairable"; });
  const { worker } = f.build();
  const runtime = createScenarioRuntime(worker);
  const talk = worker.talks.find(item => item.id === "fixture_sms_image");
  const photo = worker.contents.find(item => item.id === "fixture_image_item");
  let state = runtime.createInitialPlayerState();
  const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
  state.talks[talk.id] = initial.state;
  assert.equal(runtime.openTargetExists(photo.publicId, "messages", state), false);
  state = runtime.revealTalkMessages(state, talk.id, initial.messages);
  state.repairedContentIds.push(...runtime.observedAlbumMediaContentIds(talk, state, [photo.publicId]));
  state.repairedAppIds.push("photos");
  assert.ok(!(await runtime.publicPlayerState(state, 0)).visibleDeviceState.photos.some(item => item.contentId === photo.publicId), "観測してもcondは迂回しない");
  // 添付検索は添付側のcondで候補を出す。所有項目のcondとは別で、候補が出ても開封条件を迂回しない。
  const candidate = runtime.searchScenario("確認資料", state).find(item => item.contentId === photo.publicId);
  assert.ok(candidate);
  assert.equal(candidate.title, undefined, "所有項目の未到達タイトルを候補へ流用しない");
  assert.equal(candidate.thumbnailUrl, undefined);
  assert.equal(runtime.openTargetExists(photo.publicId, "messages", state), false);
  state.stateValues.session_started = true;
  assert.ok(runtime.searchScenario("確認資料", state).some(item => item.contentId === photo.publicId && item.appId === "messages"));
  assert.equal(runtime.openTargetExists(photo.publicId, "messages", state), true);
  assert.equal(runtime.repairTarget(photo.publicId, "messages"), null, "添付検索から所有アルバムの修復へ変えない");
  state.repairedAppIds = [];
  assert.equal(runtime.appAvailable("photos", state), false);
  assert.ok(!(await runtime.publicPlayerState(state, 1)).visibleDeviceState.photos.some(item => item.contentId === photo.publicId), "親アプリも勝手に修復しない");
});

test("対応からpartを暗黙取得せず、未取得素材を公開しない", async t => {
  const f = authoringFixture(t);
  f.edit("photo_items", rows => rows.forEach(row => { if (row.id?.startsWith("fixture_")) row.initial = "repairable"; }));
  f.edit("attachments", rows => rows.splice(rows.findIndex(item => item.id === "fixture_image"), 0, { comment: "#later" }));
  f.edit("talk_blocks", rows => rows.splice(rows.findIndex(item => item.comment === "*fixture_sms_image"), 0, { comment: "#later" }));
  // 初期履歴を後partへ置かず、取得後の通常blockとして検証する。
  for (const table of ["message_items", "chat_items"]) f.edit(table, rows => rows.forEach(row => { if (row.id?.startsWith("fixture_")) row.start = ""; }));
  const { worker } = f.build();
  const base = createScenarioRuntime(scenarioForParts(worker, ["base"]));
  assert.equal(base.resolveTalkAttachment("fixture_image"), null);
  const state = base.createInitialPlayerState();
  assert.ok(!JSON.stringify(await base.publicPlayerState(state, 0)).includes("/fixture/image.media"));
  const acquired = createScenarioRuntime(scenarioForParts(worker, ["base", "later"]));
  assert.equal(acquired.resolveTalkAttachment("fixture_image").contentId, "fixture_image_item");
});

test("static成果物でもTSV由来の添付観測からアルバムへ追加できる", async t => {
  const f = authoringFixture(t);
  f.edit("project_constants", rows => { rows.find(item => item.key === "player.mode").value = "static"; });
  const scenario = f.build();
  const outputDir = path.join(f.directory, "output");
  fs.mkdirSync(outputDir);
  staticPartLocators(f.directory, scenario.worker.project.id, scenario.worker.parts, true);
  await buildStaticScenario({ root: f.directory, outputDir, scenario });
  const origin = "https://fixture.invalid/";
  const execution = createStaticPlayerExecution({
    projectId: scenario.worker.project.id, clientRevision: scenario.worker.clientRevision,
    entryUrl: origin + "static-entry.json", storage: { mode: "memory", prefix: "album-test" },
    fetch: async url => {
      assert.ok(url.startsWith(origin));
      return new Response(fs.readFileSync(path.join(outputDir, url.slice(origin.length))), { headers: { "content-type": "application/json" } });
    },
    module: async url => import(pathToFileURL(path.join(outputDir, url.slice(origin.length))).href)
  });
  await execution.initialize();
  const request = async (route, body = {}) => {
    const response = await execution.request(route, { method: "POST", body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.playerState;
  };
  let state = await request("/api/session/start");
  const talk = scenario.worker.talks.find(item => item.id === "fixture_sms_image");
  const content = scenario.worker.contents.find(item => item.id === "fixture_image_item");
  const message = state.visibleDeviceState.messages.find(item => item.id === talk.publicId).messages[0];
  assert.equal(message.attachment.contentId, content.publicId);
  assert.ok(!state.visibleDeviceState.photos.some(item => item.contentId === content.publicId));
  state = await request("/api/content/media-observed", { appId: "messages", contentId: talk.publicId, mediaContentIds: [content.publicId] });
  assert.ok(state.visibleDeviceState.photos.some(item => item.contentId === content.publicId && !item.corrupted));
});
