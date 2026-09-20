function cueLocation(row, cueId = "") {
  return `radio_items!${row.__rowNumber}${cueId ? ` cues.${cueId}` : ".cues"}`;
}

function parseCueSeconds(value, row, cueId) {
  const location = cueLocation(row, cueId);

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${location}: cue time は 0 以上の秒数にしてください。`);
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(`${location}: cue time は秒数または MM:SS 形式の文字列にしてください。`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${location}: cue time が空です。`);
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`${location}: cue time が不正です: ${trimmed}`);
  }

  const last = parts.at(-1) ?? "";
  if (!/^\d+(?:\.\d+)?$/.test(last)) {
    throw new Error(`${location}: cue time の秒が不正です: ${trimmed}`);
  }

  const leading = parts.slice(0, -1);
  if (leading.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`${location}: cue time が不正です: ${trimmed}`);
  }

  const seconds = Number(last);
  if (seconds >= 60) {
    throw new Error(`${location}: MM:SS 形式の秒は 60 未満にしてください: ${trimmed}`);
  }

  if (parts.length === 2) {
    return Number(leading[0]) * 60 + seconds;
  }

  const minutes = Number(leading[1]);
  if (minutes >= 60) {
    throw new Error(`${location}: HH:MM:SS 形式の分は 60 未満にしてください: ${trimmed}`);
  }

  return Number(leading[0]) * 3600 + minutes * 60 + seconds;
}

export function normalizeRadioCues(row) {
  const rawValue = String(row.cues ?? "").trim();
  if (!rawValue) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${cueLocation(row)}: JSON として解釈できません。`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${cueLocation(row)}: cue ID をキー、発火時刻を値にした JSON object にしてください。`);
  }

  return Object.entries(parsed)
    .map(([id, time], order) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error(`${cueLocation(row)}: cue ID の形式が不正です: ${id}`);
      }
      const seconds = parseCueSeconds(time, row, id);
      return {
        id,
        atMs: Math.round(seconds * 1000),
        order
      };
    })
    .sort((left, right) => left.atMs - right.atMs || left.order - right.order)
    .map((cue, index) => ({
      id: cue.id,
      index: index + 1,
      atMs: cue.atMs
    }));
}
