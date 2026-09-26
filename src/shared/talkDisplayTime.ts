import { parseStoryDate } from "./storyDate.ts";

export type TalkDisplayTime = { date: string; time: string };

/** 日時は現実の瞬間ではない。端末の時差へ変換せず、従来どおり分まで表示する。 */
export function talkDisplayTimeLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { date, time } = value as Partial<TalkDisplayTime>;
  const parts = typeof date === "string" ? parseStoryDate(date) : null;
  if (!parts || typeof time !== "string") return undefined;
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u.exec(time);
  return `${parts.month}/${parts.day} ${clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : time}`;
}
