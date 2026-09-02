export function talkMessageTimeLabel(value: string) {
  const storyTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/u.exec(value);
  if (storyTimestamp) {
    return `${Number(storyTimestamp[2])}/${Number(storyTimestamp[3])} ${storyTimestamp[4]}:${storyTimestamp[5]}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  const time = parsed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}
