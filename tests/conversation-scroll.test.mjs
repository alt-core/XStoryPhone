import assert from "node:assert/strict";
import test from "node:test";
import { scrollMessageToTop } from "../src/client/apps/conversationScrollMemory.ts";

function element(offsetTop, attributes = []) {
  return { offsetTop, previousElementSibling: null, hasAttribute: (name) => attributes.includes(name) };
}

test("外から指定したメッセージの直前に日付区切りがあれば、日付区切りを上端にする", () => {
  const list = { scrollTop: 0 };
  const separator = element(400, ["data-day-separator"]);
  const message = element(430);
  message.previousElementSibling = separator;
  scrollMessageToTop(list, message);
  assert.equal(list.scrollTop, 392);
});

test("直前が日付区切りでなければ、指定したメッセージを上端にする", () => {
  for (const previous of [null, element(400)]) {
    const list = { scrollTop: 0 };
    const message = element(430);
    message.previousElementSibling = previous;
    scrollMessageToTop(list, message);
    assert.equal(list.scrollTop, 422);
  }
});

test("先頭付近のメッセージでは上端を超えてスクロールしない", () => {
  const list = { scrollTop: 50 };
  const separator = element(4, ["data-day-separator"]);
  const message = element(30);
  message.previousElementSibling = separator;
  scrollMessageToTop(list, message);
  assert.equal(list.scrollTop, 0);
});
