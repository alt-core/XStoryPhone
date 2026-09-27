import assert from "node:assert/strict";
import test from "node:test";
import { assistantNoticeTriggers, selectAssistantMessage, validAssistantTrigger } from "../src/shared/assistantMessages.ts";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";

test("操作に対応する段階だけを選び、通常案内・検索前後の文脈を混ぜない", () => {
  const message = (trigger, body, weight = 1) => ({ id: trigger, trigger, body, weight });
  const messages = [message("screen:home", "カレンダーへ"), message("blocked_link", "検索してください"),
    message("app_unavailable:messages", "アプリが使えません"), message("app_unavailable", "アプリ共通"),
    message("search_open_failed", "今は開けません"), message("repaired", "修復しました")];
  const choose = (notice, appId, rows = messages) => selectAssistantMessage(rows, assistantNoticeTriggers(notice, appId), () => 0)?.body;
  assert.equal(choose("app_unavailable", "messages"), "アプリが使えません");
  assert.equal(choose("app_unavailable", "notes"), "アプリ共通");
  assert.equal(choose("app_unavailable", "notes", messages.filter(row => !row.trigger.startsWith("app_unavailable"))), "検索してください");
  assert.equal(choose("blocked_link", "messages"), "検索してください");
  assert.equal(choose("search_open_failed", "messages"), "今は開けません");
  assert.equal(choose("search_open_failed", "messages", messages.filter(row => row.trigger !== "search_open_failed")), undefined);
  assert.equal(choose("history_repaired", "messages"), undefined, "修復種別の文脈を勝手に混ぜない");
});

test("weight=0を抽選せず、正の候補がない段階は共通行へ進む", () => {
  const message = (id, trigger, weight) => ({ id, trigger, weight, body: id });
  const rows = [message("off", "app_unavailable:messages", 0), message("common", "blocked_link", 1)];
  assert.equal(selectAssistantMessage(rows, assistantNoticeTriggers("app_unavailable", "messages"), () => 0)?.id, "common");
  rows.push(message("specific", "app_unavailable:messages", 2));
  assert.equal(selectAssistantMessage(rows, assistantNoticeTriggers("app_unavailable", "messages"), () => 0)?.id, "specific");
  assert.equal(selectAssistantMessage([message("off", "screen:home", 0)], ["screen:home"]), undefined);
  const weighted = [message("a", "repaired", 1), message("b", "repaired", 3)];
  assert.equal(selectAssistantMessage(weighted, ["repaired"], () => 0.2)?.id, "a");
  assert.equal(selectAssistantMessage(weighted, ["repaired"], () => 0.3)?.id, "b");
});

test("triggerの対象appと有限の文法を検査する", () => {
  const apps = new Set(["messages", "photos", "project_board"]);
  for (const trigger of ["screen:home", "screen:project_board", "app_unavailable:messages", "blocked_link", "album_added", "repaired:photos", "history_repaired:messages", "search_open_failed"]) {
    assert.equal(validAssistantTrigger(trigger, apps), true, trigger);
  }
  for (const trigger of ["home", "screen:unknown", "screen:home:extra", "album_added:messages", "search_open_failed:messages", "event:custom"]) {
    assert.equal(validAssistantTrigger(trigger, apps), false, trigger);
  }
});

test("破損操作の案内は通信待ちせず、同じ行でも操作ごとの表示機会を持つ", async () => {
  const shown = [];
  const messages = [{ id: "help", trigger: "app_unavailable:messages", body: "作者の案内", hide: "close", weight: 1 }];
  let resolve;
  const ctx = componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), ["recordBlockedContentLink", "showAssistantNotice"], {
    playerState: { assistantMessages: messages }, activeAppId: null, assistantNoticeSerial: 0,
    uiState: { sessionToken: "session" }, selectAssistantMessage, assistantNoticeTriggers,
    showTransientAssistantMessage: message => shown.push(message),
    recordScenarioEvent: () => new Promise(done => { resolve = done; }), applyPlayerState() {}, enqueuePresentation() {}, applyErrorPlayerState() {}
  });
  ctx.recordBlockedContentLink("messages", "room", "app_unavailable");
  assert.equal(shown[0].body, "作者の案内");
  resolve({ ok: true, playerState: {} });
  await Promise.resolve();
  ctx.recordBlockedContentLink("messages", "room", "app_unavailable");
  assert.notEqual(shown[0].id, shown[1].id);
  assert.equal(shown[0].surface, "home", "移動失敗先ではなく、現在画面で表示する");
  resolve({ ok: false });
  await Promise.resolve();
  assert.equal(shown.length, 2, "応答による再抽選・差替えはない");
});
