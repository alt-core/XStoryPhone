export function noticeTextSegments(text: string): Array<{ text: string; strong: boolean }> {
  const segments: Array<{ text: string; strong: boolean }> = [];
  let offset = 0;
  for (const match of text.matchAll(/\*\*([^*]+)\*\*/gu)) {
    if (match.index > offset) segments.push({ text: text.slice(offset, match.index), strong: false });
    segments.push({ text: match[1], strong: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset), strong: false });
  return segments;
}
