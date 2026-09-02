export const talkBlockIdSeparator = "::";
export const talkBlockRepeatMarker = "---";

const repeatBlockSuffixPattern = /@\d+$/u;

export function normalizeTalkBlockToken(value) {
  return String(value ?? "").trim().normalize("NFC");
}

export function canonicalTalkBlockId(talkId, blockKey) {
  return `${normalizeTalkBlockToken(talkId)}${talkBlockIdSeparator}${normalizeTalkBlockToken(blockKey)}`;
}

export function scopedTalkBlockLookupKey(talkId, blockKey) {
  return `${normalizeTalkBlockToken(talkId)}\0${normalizeTalkBlockToken(blockKey)}`;
}

export function parseTalkBlockComment(row) {
  const comment = normalizeTalkBlockToken(row?.comment);
  if (!comment) {
    return { type: "message", value: "" };
  }
  if (comment.startsWith(";")) {
    return { type: "comment", value: comment.slice(1).trim() };
  }
  if (comment.startsWith("*")) {
    return { type: "talk", value: normalizeTalkBlockToken(comment.slice(1)) };
  }
  if (comment === talkBlockRepeatMarker) {
    return { type: "repeat", value: comment };
  }
  return { type: "block", value: comment };
}

export function talkBlockKeyError(blockKey) {
  if (!blockKey) {
    return "block ID が空です。";
  }
  if (blockKey.startsWith("*") || blockKey.startsWith(";") || blockKey.startsWith("/")) {
    return "block ID の先頭に *、;、/ は使えません。/ はnext command用です。";
  }
  if (blockKey.includes(talkBlockIdSeparator)) {
    return `block ID に内部区切り文字 ${talkBlockIdSeparator} は使えません。`;
  }
  if (repeatBlockSuffixPattern.test(blockKey)) {
    return `block ID の末尾に @数字 は使えません。リピート用 block は ${talkBlockRepeatMarker} 行で生成してください。`;
  }
  if (/[\u0000-\u001f\u007f]/u.test(blockKey)) {
    return "block ID に制御文字は使えません。";
  }
  return "";
}

function addScopedTalkBlock(scope, talkId, blockKey, row, extraInfo = {}) {
  const lookupKey = scopedTalkBlockLookupKey(talkId, blockKey);
  const canonical = canonicalTalkBlockId(talkId, blockKey);
  if (scope.canonicalByScopedKey.has(lookupKey)) {
    scope.fail(`talk_blocks!${row.__rowNumber ?? "?"}: 同じ talk 内で block が重複しています: talk=${talkId} block=${blockKey}`);
  }

  scope.canonicalByScopedKey.set(lookupKey, canonical);
  scope.blockInfo.set(canonical, { talkId, blockKey, ...extraInfo });
  if (extraInfo.repeatOf) {
    scope.repeatInfoByBlock.set(canonical, {
      repeatOf: extraInfo.repeatOf,
      repeatIndex: extraInfo.repeatIndex
    });
  }
  if (!scope.blocks.has(canonical)) {
    scope.blocks.set(canonical, []);
  }
  const blockKeys = scope.blockKeysByTalk.get(talkId) ?? new Set();
  blockKeys.add(blockKey);
  scope.blockKeysByTalk.set(talkId, blockKeys);
  return canonical;
}

export function collectScopedTalkBlocks(rows, { onError } = {}) {
  const blocks = new Map();
  const blockInfo = new Map();
  const canonicalByScopedKey = new Map();
  const blockKeysByTalk = new Map();
  const repeatInfoByBlock = new Map();
  let currentTalk = "";
  let currentCanonical = "";
  let currentBaseCanonical = "";
  let currentBaseBlockKey = "";
  let currentRepeatIndex = 1;

  const fail = (message) => {
    if (onError) {
      onError(message);
    }
  };
  const scope = { blocks, blockInfo, canonicalByScopedKey, blockKeysByTalk, repeatInfoByBlock, fail };

  for (const row of rows ?? []) {
    const parsed = parseTalkBlockComment(row);

    if (parsed.type === "comment") {
      continue;
    }

    if (parsed.type === "talk") {
      if (!parsed.value) {
        fail(`talk_blocks!${row.__rowNumber ?? "?"}: talk ID が空です。`);
      }
      currentTalk = parsed.value;
      currentCanonical = "";
      currentBaseCanonical = "";
      currentBaseBlockKey = "";
      currentRepeatIndex = 1;
      continue;
    }

    if (parsed.type === "block") {
      const error = talkBlockKeyError(parsed.value);
      if (error) {
        fail(`talk_blocks!${row.__rowNumber ?? "?"}: ${error}: ${parsed.value}`);
      }
      if (!currentTalk) {
        fail(`talk_blocks!${row.__rowNumber ?? "?"}: block ID の前に *talk_id 行が必要です。`);
        currentCanonical = "";
        continue;
      }

      currentCanonical = addScopedTalkBlock(scope, currentTalk, parsed.value, row);
      currentBaseCanonical = currentCanonical;
      currentBaseBlockKey = parsed.value;
      currentRepeatIndex = 1;
      continue;
    }

    if (parsed.type === "repeat") {
      if (!currentTalk) {
        fail(`talk_blocks!${row.__rowNumber ?? "?"}: ${talkBlockRepeatMarker} の前に *talk_id 行が必要です。`);
        currentCanonical = "";
        continue;
      }
      if (!currentBaseCanonical || !currentBaseBlockKey) {
        fail(`talk_blocks!${row.__rowNumber ?? "?"}: ${talkBlockRepeatMarker} は通常 block ID の後に書いてください。`);
        currentCanonical = "";
        continue;
      }
      currentRepeatIndex += 1;
      const repeatBlockKey = `${currentBaseBlockKey}@${currentRepeatIndex}`;
      currentCanonical = addScopedTalkBlock(scope, currentTalk, repeatBlockKey, row, {
        repeatOf: currentBaseCanonical,
        repeatIndex: currentRepeatIndex
      });
      continue;
    }

    if (!currentTalk) {
      fail(`talk_blocks!${row.__rowNumber ?? "?"}: 所属する *talk_id がありません。`);
      continue;
    }
    if (!currentCanonical) {
      fail(`talk_blocks!${row.__rowNumber ?? "?"}: 所属する block ID がありません。`);
      continue;
    }

    const blockRows = blocks.get(currentCanonical) ?? [];
    blockRows.push(row);
    blocks.set(currentCanonical, blockRows);
  }

  return { blocks, blockInfo, canonicalByScopedKey, blockKeysByTalk, repeatInfoByBlock };
}

export function resolveScopedTalkBlockId(scope, talkId, blockKey) {
  const normalizedTalkId = normalizeTalkBlockToken(talkId);
  const normalizedBlockKey = normalizeTalkBlockToken(blockKey);
  if (normalizedBlockKey === "*") {
    return "*";
  }
  return scope.canonicalByScopedKey.get(scopedTalkBlockLookupKey(normalizedTalkId, normalizedBlockKey)) ?? "";
}

export function isRepeatTalkBlockId(scope, blockId) {
  return Boolean(scope.repeatInfoByBlock?.has(blockId));
}
