import assert from "node:assert/strict";
import test from "node:test";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import {
  contentByPublicId, createInitialPlayerState, internalAttachmentId, internalFormId,
  internalIncomingCallId, publicPlayerState, reconcileScenarioState, scenarioMessageBlockId,
  talkByPublicId, workerScenario
} from "../src/worker/scenario.ts";
import { internalizeTalkCommand } from "../src/worker/services/talkCommand.ts";

test("全公開IDは名前空間を保ち、内部IDと衝突せず一意に生成する", () => {
  const prefixes = { content: "c", talk: "t", attachment: "a", incomingCall: "call", form: "form", notification: "notification", generatedAudio: "g", scenarioEvent: "e" };
  const first = loadAndValidateScenario();
  const second = loadAndValidateScenario();
  assert.deepEqual(first.worker.publicIds, second.worker.publicIds);
  assert.deepEqual(Object.keys(first.worker.publicIds).sort(), Object.keys(prefixes).sort());
  const seen = new Set();
  for (const [namespace, values] of Object.entries(first.worker.publicIds)) {
    for (const [internalId, publicId] of Object.entries(values)) {
      assert.match(publicId, new RegExp(`^${prefixes[namespace]}_[a-f0-9]{12}$`, "u"));
      assert.notEqual(publicId, internalId);
      assert.equal(seen.has(publicId), false, `${namespace}の公開ID衝突`);
      seen.add(publicId);
    }
  }
});

test("公開ID lookupは実在する内部IDや未知IDを旧形式として受理しない", () => {
  const lookups = {
    content: (id) => contentByPublicId(id)?.id ?? "",
    talk: (id) => talkByPublicId(id)?.id ?? "",
    attachment: internalAttachmentId,
    incomingCall: internalIncomingCallId,
    form: internalFormId
  };
  for (const [namespace, lookup] of Object.entries(lookups)) {
    assert.equal(lookup("unknown-public-id"), "");
    for (const [internalId, publicId] of Object.entries(workerScenario.publicIds[namespace])) {
      assert.equal(lookup(publicId), internalId);
      assert.equal(lookup(internalId), "");
    }
  }
  for (const [internalId, publicId] of Object.entries(workerScenario.publicIds.content)) {
    for (const kind of ["photo", "share"]) {
      assert.equal(internalizeTalkCommand(`${kind}:${publicId}`), `${kind}:${internalId}`);
      assert.equal(internalizeTalkCommand(`${kind}:${internalId}`), `${kind}:__invalid_content__`);
    }
  }
});

test("公開PlayerStateは内部stateやcompact履歴fieldをspreadせず、許可した投影だけを返す", async () => {
  const initialized = await reconcileScenarioState(createInitialPlayerState(), "private-player-marker");
  initialized.state.privateAuditMarker = "private-field-must-not-leak";
  const projected = await publicPlayerState(initialized.state, 1, [], null, initialized.transcriptAppends);
  assert.equal(JSON.stringify(projected).includes("private-field-must-not-leak"), false);
  const forbidden = new Set(["privateAuditMarker", "stateValues", "progress_json", "hookState", "format_env_json", "block_id", "inputHash", "r2Key", "externalJobId"]);
  function check(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `内部fieldが公開された: ${key}`);
      check(child);
    }
  }
  check(projected);
  for (const talk of projected.talks) {
    assert.equal("from" in talk, false);
    assert.equal("fromId" in talk, false);
  }
  const blockId = await scenarioMessageBlockId("private-player-marker", "sms", "guide", "guide::reply");
  assert.equal(blockId.includes("private-player-marker"), false);
  assert.match(blockId, /^sms_block_[a-f0-9]{32}$/u);
});
