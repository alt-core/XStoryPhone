export type StoryDateParts = {
  year: number;
  month: number;
  day: number;
};

export type StoryWeekDay = StoryDateParts & {
  value: string;
  weekdayLabel: string;
};

const storyDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 作中の日付は、現実世界の瞬間ではなくタイムゾーンを持たない暦日として扱う。
 * Date.parse・UTC API・toISOString は使わず、暦計算に限ってローカル正午の Date を使う。
 * 正午に固定することで、日付境界や一般的な夏時間変更の影響を避ける。
 */
export function parseStoryDate(value: string): StoryDateParts | null {
  const match = storyDatePattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { year, month, day };
}

export function formatStoryDate(parts: StoryDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function storyDateAtLocalNoon(value: string): Date | null {
  const parts = parseStoryDate(value);
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 12) : null;
}

export function formatStoryDateLabel(value: string): string {
  const date = storyDateAtLocalNoon(value);
  if (!date) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdayLabels[date.getDay()]}）`;
}

export function formatStoryDateCompact(value: string): string {
  const parts = parseStoryDate(value);
  return parts ? `${parts.month}/${parts.day}` : "今日";
}

export function storyWeekFor(value: string): StoryWeekDay[] {
  const anchor = storyDateAtLocalNoon(value);
  if (!anchor) return [];

  const mondayOffset = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() + index);
    const parts = {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate()
    };
    return {
      ...parts,
      value: formatStoryDate(parts),
      weekdayLabel: weekdayLabels[date.getDay()]
    };
  });
}
