import assert from "node:assert/strict";
import test from "node:test";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { createPartSession } from "../src/worker/partSession.ts";
import { createPlayerOperations } from "../src/server/playerApp.ts";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { encodeBrowserProgress } from "../src/server/browserProgress.ts";

test("標準eventの対象IDをhookへ渡す直前に内部化し、任意fieldは書き換えない", async () => {
  const { worker } = loadAndValidateScenario();
  worker.playerMode = "browser";
  worker.hooks = [{event:"blocked_content_link_opened",target:"messages",handler:"capture",cond:"",part:"base"}];
  let received;
  const parts = createPartSession(worker, { capture(_context, event) { received = event; } });
  const runtime = parts.runtime;
  const operations = createPlayerOperations(runtime, parts.hooks, createGeneratedAudioRuntime(runtime), undefined, parts);
  const secret = "local-event-contract";
  const token = await encodeBrowserProgress(secret, worker.project.id, {id:"fixture",state:runtime.createInitialPlayerState(),stateVersion:0});
  const talk = worker.talks.find(item=>item.kind==="sms");
  const content = worker.contents.find(item=>item.appId==="notes");
  const [attachment, publicAttachment] = Object.entries(worker.publicIds.attachment)[0];
  const [call, publicCall] = Object.entries(worker.publicIds.incomingCall)[0];
  for (const target of [talk,content,{id:"photos",publicId:"photos"}]) {
    const result = await operations.execute("POST /api/scenario/event", {hostname:"localhost",body:{
      progressToken:token,eventId:"blocked_content_link_opened",contentId:"messages",
      fields:{attemptedContentId:target.publicId,talkId:talk.publicId,attachmentId:publicAttachment,callId:publicCall,customId:target.publicId}
    }}, {store:{},config:{appEnv:"development",browserStateSecret:secret,llm:{}}});
    assert.equal(result.status,200);
    assert.equal(received.contentId,"messages");
    assert.equal(received.fields.attemptedContentId,target.id);
    assert.equal(received.talkId,talk.id);
    assert.equal(received.attachmentId,attachment);
    assert.equal(received.callId,call);
    assert.equal(received.fields.customId,target.publicId);
    assert.equal(runtime.internalOpenTargetId(target.publicId),target.id);
  }
});
