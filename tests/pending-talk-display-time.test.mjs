import assert from "node:assert/strict";
import test from "node:test";
import { componentFunctionHarness } from "./helpers/component-script-harness.mjs";
import { captureTalkDisplayTime } from "../src/worker/talkDisplayClock.ts";
import { talkDisplayTimeLabel } from "../src/shared/talkDisplayTime.ts";
import { talkMessageDisplayTime, talkMessageTimeLabel } from "../src/client/apps/talkMessageTime.ts";

const realSentAt = "2026-09-26T03:00:00.000Z";
class FixedDate extends Date {
  constructor(value) { super(value === undefined ? realSentAt : value); }
}

function pendingHarness(mode = "scenario") {
  return componentFunctionHarness(new URL("../src/client/App.svelte", import.meta.url), [
    "startPendingTalkSend", "finishPendingTalkSend", "clearReplyDelayAnchor",
    "mergeSmsMessages", "mergeChatMessages", "photoAttachmentFromBody", "shareAttachmentFromBody",
    "radioContentId", "talkMessageBody", "applyAttachmentState", "isLockedAttachment",
    "photoMessagePattern", "shareMessagePattern"
  ], {
    Date: FixedDate, talkMessageDisplayTime, talkDisplayTimeLabel,
    projectConstants: { "talk.clock": mode, "device.date": "2001-01-01" },
    playerState: {
      scenarioTime: { date: "2032-02-29", timeLabel: "9:07:59" },
      smsMessages: [], chatMessages: [], contentStates: [], unlockedAttachments: []
    },
    pendingTalkMessageCounter: 0, pendingTalkMessages: [], replyDelayAnchorsByThread: {}
  });
}

const photos = [
  { id: "photo-a", imageUrl: "/fixture/photo.svg" },
  { id: "video-a", mediaKind: "video", videoUrl: "/fixture/video.mp4" }
];
const radios = [{ id: "radio-a", programTitle: "共有の音声" }];

for (const kind of ["sms", "chat"]) {
  test(`${kind}: 本文・写真・動画・共有の仮表示を確定表示と同じ時計で表示する`, () => {
    const view = componentFunctionHarness(new URL(`../src/client/apps/${kind === "sms" ? "MessagesApp" : "ChatApp"}.svelte`, import.meta.url), [
      "explicitDateLabel", "messageDateLabel"
    ], { initialDateLabel: "1/1" });
    for (const mode of ["scenario", "real"]) {
      for (const [body, attachmentKind] of [["送信する本文", undefined], ["photo:photo-a", "image"], ["photo:video-a", "video"], ["share:radio-a", "share"]]) {
        const c = pendingHarness(mode);
        const state = c.playerState;
        const snapshot = captureTalkDisplayTime(mode, { os_date: state.scenarioTime.date, os_time_label: state.scenarioTime.timeLabel });
        const displayTime = snapshot ? talkDisplayTimeLabel(snapshot) : undefined;
        c.startPendingTalkSend(kind, "room", body);
        const pending = c.pendingTalkMessages[0];
        assert.equal(pending.sentAt, realSentAt, "記録順用の時刻は現実のISO日時のまま");
        assert.equal(pending.displayTime, displayTime);
        const threads = [{ id: "room", messages: [{ id: "history", sender: "other", body: "以前の履歴", sentAt: "2/28 18:00" }] }];
        const merge = kind === "sms" ? c.mergeSmsMessages : c.mergeChatMessages;
        const before = merge(threads, state, photos, radios, c.pendingTalkMessages, [])[0].messages;
        assert.equal(before.at(-1).attachment?.kind, attachmentKind);

        // 応答の状態更新で時計が変わっても、プレイヤー発言は送信時の時計を使う。
        state.scenarioTime = { date: "2032-03-01", timeLabel: "夕方" };
        const stillPending = merge(threads, state, photos, radios, c.pendingTalkMessages, [])[0].messages;
        assert.equal(stillPending.at(-1).sentAt, before.at(-1).sentAt);
        state[kind === "sms" ? "smsMessages" : "chatMessages"] = [{
          ...pending, id: "confirmed", displayTime
        }];
        c.finishPendingTalkSend(kind, "room");
        const after = merge(threads, state, photos, radios, c.pendingTalkMessages, [])[0].messages;
        assert.equal(after.at(-1).sentAt, mode === "scenario" ? "2/29 09:07" : talkMessageTimeLabel(realSentAt));
        assert.equal(after.at(-1).sentAt, before.at(-1).sentAt);
        assert.equal(view.messageDateLabel(before, before.length - 1), view.messageDateLabel(after, after.length - 1));
        assert.equal(after[0].sentAt, "2/28 18:00", "過去履歴の表示日時を変更しない");
        assert.equal(c.pendingTalkMessages.length, 0);
        assert.equal(Object.keys(c.replyDelayAnchorsByThread).length, 0);
      }
    }
  });
}

test("作中時計変更後の次の送信は新しい日時を捕捉し、自由な時刻ラベルを保持する", () => {
  const c = pendingHarness();
  c.startPendingTalkSend("sms", "room-a", "一回目");
  c.playerState.scenarioTime.date = "2032-03-01";
  c.playerState.scenarioTime.timeLabel = "夕方";
  c.startPendingTalkSend("chat", "room-b", "二回目");
  assert.equal(c.pendingTalkMessages[0].displayTime, "2/29 09:07");
  assert.equal(c.pendingTalkMessages[1].displayTime, "3/1 夕方");
  assert.ok(c.pendingTalkMessages.every(message => message.sentAt === realSentAt));
});
