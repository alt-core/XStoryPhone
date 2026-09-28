import { renderTemplate } from "../../src/shared/condition.ts";

// 選択中の原本から作る。別シナリオの生成済みsingletonを試験文脈へ混ぜない。
export function talkTestContext(scenario, { talkId, from, stateValues: overrides = {}, recentMessages = [] }) {
  const talk = scenario.talks.find((item) => item.id === talkId);
  if (!talk) throw new Error(`talkが存在しません: ${talkId}`);
  const fromId = from.includes("::") ? from : `${talkId}::${from}`;
  const stateValues = { ...scenario.stateVariables, ...overrides };
  const env = Object.fromEntries(Object.entries(stateValues)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => [key, String(value)]));
  const people = new Map(scenario.talkPeople.map((item) => [item.id, item]));
  const fromBlock = scenario.talkBlocks.find((item) => (item.id ?? item.block) === fromId);
  const fromMessages = (fromBlock?.messages ?? []).slice(-2).map((message) => {
    const person = people.get(message.sender);
    return {
      speaker: person?.role === "owner" ? "phone_owner" : person?.name || talk.label || "other",
      body: renderTemplate(message.body ?? "", env).trim()
    };
  }).filter((message) => message.body);
  const seen = new Set();
  const combinedMessages = [...fromMessages, ...recentMessages.filter((message) => message.body).slice(-2)]
    .filter((message) => {
      const key = `${message.speaker}\0${message.body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { talk, fromId, stateValues, recentMessages: combinedMessages };
}
