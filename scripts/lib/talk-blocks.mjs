export const talkBlockIdSeparator = "::";
export const talkBlockRepeatMarker = "---";

function normalize(value) {
  return String(value ?? "").trim().normalize("NFC");
}

export function canonicalTalkBlockId(talkId, blockKey) {
  return `${normalize(talkId)}${talkBlockIdSeparator}${normalize(blockKey)}`;
}

function lookupKey(talkId, blockKey) {
  return `${normalize(talkId)}\0${normalize(blockKey)}`;
}

function parsedComment(row) {
  const comment = normalize(row?.comment);
  if (!comment) return { type: "message", value: "" };
  if (comment.startsWith(";")) return { type: "comment", value: comment.slice(1).trim() };
  if (comment.startsWith("*")) return { type: "talk", value: normalize(comment.slice(1)) };
  if (comment === talkBlockRepeatMarker) return { type: "repeat", value: comment };
  return { type: "block", value: comment };
}

export function collectScopedTalkBlocks(rows, errors = []) {
  const blocks = new Map();
  const infoById = new Map();
  const idByScope = new Map();
  const repeatIdsByBase = new Map();
  let talkId = "";
  let blockId = "";
  let baseId = "";
  let baseKey = "";
  let repeatIndex = 1;

  const add = (blockKey, row, repeatOf = "") => {
    const scopedKey = lookupKey(talkId, blockKey);
    const canonicalId = canonicalTalkBlockId(talkId, blockKey);
    if (idByScope.has(scopedKey)) {
      errors.push(`talk_blocks.tsv:${row.__rowNumber}: block が重複しています: ${talkId}/${blockKey}`);
    }
    idByScope.set(scopedKey, canonicalId);
    infoById.set(canonicalId, { talkId, blockKey, ...(repeatOf ? { repeatOf, repeatIndex } : {}) });
    blocks.set(canonicalId, []);
    if (repeatOf) repeatIdsByBase.set(repeatOf, [...(repeatIdsByBase.get(repeatOf) ?? []), canonicalId]);
    return canonicalId;
  };

  for (const row of rows) {
    const parsed = parsedComment(row);
    if (parsed.type === "comment") continue;
    if (parsed.type === "talk") {
      talkId = parsed.value;
      blockId = "";
      baseId = "";
      baseKey = "";
      repeatIndex = 1;
      if (!talkId) errors.push(`talk_blocks.tsv:${row.__rowNumber}: talk ID が空です。`);
      continue;
    }
    if (parsed.type === "block") {
      if (!talkId) {
        errors.push(`talk_blocks.tsv:${row.__rowNumber}: block の前に *talk_id 行が必要です。`);
        continue;
      }
      if (!parsed.value || parsed.value.includes(talkBlockIdSeparator) || parsed.value.startsWith(";")) {
        errors.push(`talk_blocks.tsv:${row.__rowNumber}: block ID が不正です: ${parsed.value}`);
      }
      blockId = add(parsed.value, row);
      baseId = blockId;
      baseKey = parsed.value;
      repeatIndex = 1;
      continue;
    }
    if (parsed.type === "repeat") {
      if (!baseId) {
        errors.push(`talk_blocks.tsv:${row.__rowNumber}: --- は通常blockの後に書いてください。`);
        continue;
      }
      repeatIndex += 1;
      blockId = add(`${baseKey}@${repeatIndex}`, row, baseId);
      continue;
    }
    if (!blockId) {
      errors.push(`talk_blocks.tsv:${row.__rowNumber}: メッセージの所属blockがありません。`);
      continue;
    }
    blocks.get(blockId)?.push(row);
  }

  return { blocks, infoById, idByScope, repeatIdsByBase };
}

export function resolveScopedTalkBlockId(scope, talkId, blockKey) {
  if (normalize(blockKey) === "*") return "*";
  return scope.idByScope.get(lookupKey(talkId, blockKey)) ?? "";
}
