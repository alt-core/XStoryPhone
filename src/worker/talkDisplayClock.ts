import { parseStoryDate } from "../shared/storyDate.ts";

// 状態変数・抽出値のtemplate参照に使えない記号を含め、作者のenvと衝突させない。
export const TALK_DISPLAY_TIME_KEY = "$display_time";
export type TalkDisplayTime = { date: string; time: string };

/** 表示時刻は作者の指定をそのまま捕捉する。記録順序の時計とは独立し、自動で進めない。 */
export function captureTalkDisplayTime(mode: "real" | "scenario", env: Record<string, unknown>): TalkDisplayTime | undefined {
  if (mode !== "scenario") return undefined;
  const date = env.os_date;
  const time = env.os_time_label;
  if (typeof date !== "string" || !parseStoryDate(date) || typeof time !== "string" || !time.trim()) {
    throw new Error("会話の作中日時には有効なos_dateとos_time_labelが必要です。");
  }
  return { date, time };
}

export function talkEventFormatEnv(env: Record<string, string> | undefined, displayTime?: TalkDisplayTime) {
  if (!env && !displayTime) return null;
  return JSON.stringify({ ...env, ...(displayTime ? { [TALK_DISPLAY_TIME_KEY]: displayTime } : {}) });
}

/** 日時は現実の瞬間ではない。端末の時差へ変換せず、従来どおり分まで表示する。 */
export function talkDisplayTimeLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { date, time } = value as Partial<TalkDisplayTime>;
  const parts = typeof date === "string" ? parseStoryDate(date) : null;
  if (!parts || typeof time !== "string") return undefined;
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u.exec(time);
  return `${parts.month}/${parts.day} ${clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : time}`;
}
