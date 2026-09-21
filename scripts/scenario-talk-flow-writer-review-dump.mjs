import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { collectScopedTalkBlocks, resolveScopedTalkBlockId } from "./lib/talk-blocks.mjs";
import {
  formatTalkOutputStep,
  outputStepBlockKeys,
  outputStepNextFromKey,
  parseTalkOutputSteps
} from "./lib/talk-output-steps.mjs";
import { text } from "./lib/tsv-utils.mjs";
import { loadLocalTalkAuthoring } from "./lib/local-talk-authoring.mjs";

const rootDir = process.cwd();

function parseArgs(argv) {
  const args = new Map();
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, value] = arg.slice(2).split(/=(.*)/s, 2);
      args.set(key, value);
    } else if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
    }
  }
  return { args, flags };
}


function safePathToken(value) {
  return value.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_");
}

function splitFilterList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function outputPathFor(args, talkFilters, fromFilter, groupByFrom) {
  const explicit = args.get("output");
  if (explicit) {
    return path.resolve(rootDir, explicit);
  }

  const suffixParts = [];
  if (talkFilters.length) {
    suffixParts.push(talkFilters.map(safePathToken).join("-"));
  }
  if (fromFilter) {
    suffixParts.push(safePathToken(fromFilter));
  }
  if (groupByFrom) {
    suffixParts.push("by-from");
  }

  const suffix = suffixParts.length ? suffixParts.join("-") : "all";
  return path.join("/private/tmp", `xstoryphone-talk-flow-writer-review-${suffix}.md`);
}

function visibleText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function oneLine(value) {
  return visibleText(value).replace(/\s+/gu, " ");
}

function personName(people, senderId) {
  return people.get(senderId) ?? senderId;
}

function formatMessage(row, people) {
  const sender = personName(people, text(row, "sender"));
  const body = visibleText(row.body);
  const attachment = text(row, "attachment");
  const parts = [];
  if (body) {
    parts.push(body);
  }
  if (attachment) {
    parts.push(`[attachment: ${attachment}]`);
  }
  const quickReplies = String(row.quick_replies ?? "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  if (quickReplies.length) {
    parts.push(`[Quick Reply: ${quickReplies.join(" / ")}]`);
  }
  return `${sender}: ${parts.join(" ")}`;
}

function hasVisibleRows(rows) {
  return rows.some((row) => visibleText(row.body) || text(row, "attachment"));
}

function lastVisibleMessage(rows) {
  return [...(rows ?? [])].reverse().find((row) => visibleText(row.body) || text(row, "attachment"));
}

function pushMessageRows(lines, rows, people, { quote = false } = {}) {
  for (const row of rows) {
    if (!visibleText(row.body) && !text(row, "attachment")) {
      continue;
    }
    const message = formatMessage(row, people);
    lines.push(quote ? `> ${message}` : message);
  }
}

function blockIdForBlock(blockScope, talk, blockKey) {
  return resolveScopedTalkBlockId(blockScope, talk, blockKey);
}

function baseRowsForBlock(blockScope, talk, blockKey) {
  const blockId = blockIdForBlock(blockScope, talk, blockKey);
  return blockId ? (blockScope.blocks.get(blockId) ?? []) : [];
}

function pushBlockRows(lines, blockScope, people, talk, blockKey, displayedBlockCounts) {
  const blockId = blockIdForBlock(blockScope, talk, blockKey);
  if (!blockId) {
    return;
  }

  const previousDisplayCount = displayedBlockCounts.get(blockId) ?? 0;
  displayedBlockCounts.set(blockId, previousDisplayCount + 1);
  pushMessageRows(lines, blockScope.blocks.get(blockId) ?? [], people, {
    quote: previousDisplayCount > 0
  });
}

function outputStepsForRow(row) {
  return parseTalkOutputSteps(row.next).steps;
}

function pushOutputSteps(lines, steps, blockScope, people, talk, displayedBlockCounts) {
  for (const step of steps) {
    if (step.kind === "load") {
      lines.push(`[part取得] ${step.partId}`);
    } else if (step.kind === "search") {
      lines.push(`[検索] ${step.queryTemplate}`);
    } else if (step.kind === "input") {
      lines.push(`[入力] ${step.action}`);
    } else {
      if (step.kind === "if") lines.push(`[条件: ${step.cond}]`);
      pushBlockRows(lines, blockScope, people, talk, step.blockKey, displayedBlockCounts);
    }
  }
}

function buildRepeatRowsByBase(blockScope) {
  const repeatRowsByBase = new Map();

  for (const [repeatBlockId, repeatInfo] of blockScope.repeatInfoByBlock.entries()) {
    const baseInfo = blockScope.blockInfo.get(repeatInfo.repeatOf);
    const repeatRows = blockScope.blocks.get(repeatBlockId) ?? [];
    if (!baseInfo || !hasVisibleRows(repeatRows)) {
      continue;
    }

    const baseKey = `${baseInfo.talkId}\0${baseInfo.blockKey}`;
    const entries = repeatRowsByBase.get(baseKey) ?? [];
    entries.push({ repeatIndex: repeatInfo.repeatIndex, rows: repeatRows });
    repeatRowsByBase.set(baseKey, entries);
  }

  for (const entries of repeatRowsByBase.values()) {
    entries.sort((left, right) => left.repeatIndex - right.repeatIndex);
  }

  return repeatRowsByBase;
}

function repeatRowsForBlock(repeatRowsByBase, talk, blockKey, repeatIndex) {
  const entries = repeatRowsByBase.get(`${talk}\0${blockKey}`) ?? [];
  return entries.find((entry) => entry.repeatIndex === repeatIndex)?.rows ?? [];
}

function maxRepeatIndexForPath(repeatRowsByBase, talk, nextBlocks) {
  let max = 1;
  for (const blockKey of nextBlocks) {
    const entries = repeatRowsByBase.get(`${talk}\0${blockKey}`) ?? [];
    for (const entry of entries) {
      max = Math.max(max, entry.repeatIndex);
    }
  }
  return max;
}

function fromLabel(from) {
  return from === "*" ? "全シーン共通ガード" : from;
}

function groupRowsByTalk(rows) {
  const talks = [];
  const rowsByTalk = new Map();

  for (const row of rows) {
    const talk = text(row, "talk");
    if (!rowsByTalk.has(talk)) {
      rowsByTalk.set(talk, []);
      talks.push(talk);
    }
    rowsByTalk.get(talk).push(row);
  }

  return { talks, rowsByTalk };
}

function groupRowsByTalkAndFrom(rows) {
  const talks = [];
  const rowsByTalk = new Map();

  for (const row of rows) {
    const talk = text(row, "talk");
    const from = text(row, "from");
    if (!rowsByTalk.has(talk)) {
      rowsByTalk.set(talk, { froms: [], rowsByFrom: new Map() });
      talks.push(talk);
    }
    const talkGroup = rowsByTalk.get(talk);
    if (!talkGroup.rowsByFrom.has(from)) {
      talkGroup.rowsByFrom.set(from, []);
      talkGroup.froms.push(from);
    }
    talkGroup.rowsByFrom.get(from).push(row);
  }

  return { talks, rowsByTalk };
}

function defaultCriteriaFor(rows) {
  const defaultRow = rows.find((row) => row.type === "default");
  return visibleText(defaultRow?.criteria);
}

function ruleMode(row) {
  return text(row, "mode") || "advance";
}

function statusLineForRule(row) {
  const mode = ruleMode(row);
  if (mode === "stay") {
    return "（同じ状態を維持）";
  }
  if (mode === "game_over") {
    return "（GAME OVER）";
  }
  return "";
}

function buildRepresentativeIncomingByTalkAndFrom(rows) {
  const incomingByTalkAndFrom = new Map();

  for (const row of rows) {
    if (ruleMode(row) !== "advance") {
      continue;
    }

    const talk = text(row, "talk");
    const outputSteps = outputStepsForRow(row);
    const toFrom = outputStepNextFromKey(outputSteps);
    const transitionIndex = outputSteps.findLastIndex((step) => step.kind === "block");
    const leadBlocks = outputStepBlockKeys(outputSteps.filter((_step, index) => index !== transitionIndex));
    if (!talk || !toFrom) {
      continue;
    }

    const key = `${talk}\0${toFrom}`;
    if (incomingByTalkAndFrom.has(key)) {
      continue;
    }

    incomingByTalkAndFrom.set(key, {
      from: text(row, "from"),
      intent: text(row, "intent") || "default",
      leadBlocks
    });
  }

  return incomingByTalkAndFrom;
}

function representativeIncomingLabel(incomingByTalkAndFrom, talk, from) {
  const incoming = incomingByTalkAndFrom.get(`${talk}\0${from}`);
  if (!incoming) {
    return "";
  }

  const blocks = representativeIncomingBlocks(incomingByTalkAndFrom, talk, from);
  return `${fromLabel(incoming.from)} / ${incoming.intent} → ${blocks.map((block) => `(${block})`).join(", ")}`;
}

function representativeIncomingBlocks(incomingByTalkAndFrom, talk, from) {
  const incoming = incomingByTalkAndFrom.get(`${talk}\0${from}`);
  const blocks = incoming ? [...incoming.leadBlocks] : [];
  if (from && from !== "*") {
    blocks.push(from);
  }
  return blocks;
}

function pushIndependentBlocks(lines, blockScope, people, talk, displayedBlockCounts) {
  const independentBlocks = [];

  for (const blockKey of blockScope.blockKeysByTalk.get(talk) ?? []) {
    const blockId = blockIdForBlock(blockScope, talk, blockKey);
    if (!blockId || displayedBlockCounts.has(blockId) || blockScope.repeatInfoByBlock.has(blockId)) {
      continue;
    }

    const rows = blockScope.blocks.get(blockId) ?? [];
    if (!hasVisibleRows(rows)) {
      continue;
    }

    independentBlocks.push({ blockKey, rows });
  }

  if (!independentBlocks.length) {
    return;
  }

  lines.push("## 独立ブロック");
  lines.push("");
  for (const { blockKey, rows } of independentBlocks) {
    lines.push(`### ${blockKey}`);
    lines.push("");
    pushMessageRows(lines, rows, people);
    lines.push("");
  }
}

function hasIndependentBlocks(blockScope, talk, displayedBlockCounts = new Map()) {
  for (const blockKey of blockScope.blockKeysByTalk.get(talk) ?? []) {
    const blockId = blockIdForBlock(blockScope, talk, blockKey);
    if (!blockId || displayedBlockCounts.has(blockId) || blockScope.repeatInfoByBlock.has(blockId)) {
      continue;
    }

    const rows = blockScope.blocks.get(blockId) ?? [];
    if (hasVisibleRows(rows)) {
      return true;
    }
  }
  return false;
}

function pushTalkBlockOnlyReviews(lines, blockScope, people, renderedTalks, talkFilters) {
  for (const talk of blockScope.blockKeysByTalk.keys()) {
    if (renderedTalks.has(talk)) {
      continue;
    }
    if (talkFilters.length && !talkFilters.includes(talk)) {
      continue;
    }
    if (!hasIndependentBlocks(blockScope, talk)) {
      continue;
    }

    lines.push(`# ${talk}`);
    lines.push("");
    pushIndependentBlocks(lines, blockScope, people, talk, new Map());
  }
}

function pushInitialSteps(lines, initialStepsByTalk, blockScope, people, talk, displayedBlockCounts) {
  const steps = initialStepsByTalk.get(talk) ?? [];
  if (!steps.length) return;
  lines.push("## 初期step");
  lines.push("");
  pushOutputSteps(lines, steps, blockScope, people, talk, displayedBlockCounts);
  lines.push("");
}

function pushGroupedReview(lines, rowsByTalk, talks, blockScope, people, repeatRowsByBase, incomingByTalkAndFrom, initialStepsByTalk) {
  for (const talk of talks) {
    const talkGroup = rowsByTalk.get(talk);
    const displayedBlockCounts = new Map();
    lines.push(`# ${talk}`);
    lines.push("");
    pushInitialSteps(lines, initialStepsByTalk, blockScope, people, talk, displayedBlockCounts);

    for (const from of talkGroup.froms) {
      const rows = talkGroup.rowsByFrom.get(from);
      const criteria = defaultCriteriaFor(rows);
      const incomingLabel = representativeIncomingLabel(incomingByTalkAndFrom, talk, from);
      const headingSuffix = incomingLabel ? `（代表到達: ${incomingLabel}）` : "";

      lines.push(`## ${fromLabel(from)}${headingSuffix}`);
      lines.push("");

      if (criteria) {
        for (const line of criteria.split("\n")) {
          lines.push(`> ${line}`);
        }
        lines.push("");
      }

      const incomingBlocks = representativeIncomingBlocks(incomingByTalkAndFrom, talk, from);
      if (incomingBlocks.some((blockKey) => hasVisibleRows(baseRowsForBlock(blockScope, talk, blockKey)))) {
        lines.push("代表到達:");
        for (const blockKey of incomingBlocks) {
          pushBlockRows(lines, blockScope, people, talk, blockKey, displayedBlockCounts);
        }
        lines.push("");
      }

      const fromRows = baseRowsForBlock(blockScope, talk, from);
      const fromLast = lastVisibleMessage(fromRows);

      for (const row of rows) {
        const intent = text(row, "intent") || "default";
        const outputSteps = outputStepsForRow(row);
        const nextBlocks = outputStepBlockKeys(outputSteps);
        const example = oneLine(row.example) || "（exampleなし）";

        lines.push(`### (${from}) / ${intent} → ${outputSteps.map(formatTalkOutputStep).join(" → ")}`);
        lines.push("");
        lines.push(`part: ${row.__part ?? "base"} / type: ${row.type}`);
        lines.push("");

        if (fromLast) {
          lines.push(`> ${formatMessage(fromLast, people)}`);
        }

        lines.push(`> プレイヤー: ${example}`);
        pushOutputSteps(lines, outputSteps, blockScope, people, talk, displayedBlockCounts);

        const maxRepeatIndex = maxRepeatIndexForPath(repeatRowsByBase, talk, nextBlocks);
        for (let repeatIndex = 2; repeatIndex <= maxRepeatIndex; repeatIndex += 1) {
          const repeatGroups = nextBlocks
            .map((blockKey) => repeatRowsForBlock(repeatRowsByBase, talk, blockKey, repeatIndex))
            .filter(hasVisibleRows);
          if (!repeatGroups.length) {
            continue;
          }

          lines.push(`> プレイヤー: ${example}`);
          for (const repeatRows of repeatGroups) {
            pushMessageRows(lines, repeatRows, people);
          }
        }

        const statusLine = statusLineForRule(row);
        if (statusLine) {
          lines.push(statusLine);
        }

        lines.push("");
      }
    }

    pushIndependentBlocks(lines, blockScope, people, talk, displayedBlockCounts);
  }
}

function pushFlatReview(lines, rowsByTalk, talks, blockScope, people, repeatRowsByBase, initialStepsByTalk) {
  for (const talk of talks) {
    const displayedBlockCounts = new Map();
    lines.push(`# ${talk}`);
    lines.push("");
    pushInitialSteps(lines, initialStepsByTalk, blockScope, people, talk, displayedBlockCounts);

    for (const row of rowsByTalk.get(talk)) {
      const from = text(row, "from");
      const intent = text(row, "intent") || "default";
      const outputSteps = outputStepsForRow(row);
      const nextBlocks = outputStepBlockKeys(outputSteps);
      const example = oneLine(row.example) || "（exampleなし）";
      const fromRows = baseRowsForBlock(blockScope, talk, from);
      const fromLast = lastVisibleMessage(fromRows);

      lines.push(`### (${from}) / ${intent} → ${outputSteps.map(formatTalkOutputStep).join(" → ")}`);
      lines.push("");

      if (fromLast) {
        lines.push(`> ${formatMessage(fromLast, people)}`);
      }

      lines.push(`> プレイヤー: ${example}`);
      pushOutputSteps(lines, outputSteps, blockScope, people, talk, displayedBlockCounts);

      const maxRepeatIndex = maxRepeatIndexForPath(repeatRowsByBase, talk, nextBlocks);
      for (let repeatIndex = 2; repeatIndex <= maxRepeatIndex; repeatIndex += 1) {
        const repeatGroups = nextBlocks
          .map((blockKey) => repeatRowsForBlock(repeatRowsByBase, talk, blockKey, repeatIndex))
          .filter(hasVisibleRows);
        if (!repeatGroups.length) {
          continue;
        }

        lines.push(`> プレイヤー: ${example}`);
        for (const rows of repeatGroups) {
          pushMessageRows(lines, rows, people);
        }
      }

      const statusLine = statusLineForRule(row);
      if (statusLine) {
        lines.push(statusLine);
      }

      lines.push("");
    }

    pushIndependentBlocks(lines, blockScope, people, talk, displayedBlockCounts);
  }
}

function pushPartReview(lines, authoring, blockScope) {
  const source = authoring.source;
  if ((source.partIds ?? []).length <= 1) return;
  lines.push("## part配布の確認（作品全体）", "", "取得済part内は解析可能です。追加取得なしのpasswordは、本文を先行配布する解錠演出として使えます。", "");
  for (const part of source.partIds) {
    lines.push(`### #${part}`, "");
    for (const [group, owners] of Object.entries(source.partOwnership)) {
      const ids = Object.entries(owners).filter(([, owner]) => owner === part).map(([id]) => id);
      if (ids.length) lines.push(`- ${group}: ${ids.join(", ")}`);
    }
    const blocks = [...blockScope.blockInfo].filter(([, block]) => block.part === part).map(([id]) => id);
    if (blocks.length) lines.push(`- talk_blocks: ${blocks.join(", ")}`);
    if (part === "base") lines.push("- 取得入口: 新規開始");
    for (const row of authoring.flowRows) {
      if (outputStepsForRow(row).some(step => step.kind === "load" && step.partId === part)) lines.push(`- 取得入口: talk_flow ${text(row, "talk")}/${text(row, "from")} → /load ${part}`);
    }
    for (const content of source.contents) if (content.record.unlockLoadParts?.includes(part)) lines.push(`- 取得入口: passwords ${content.id}`);
    if (source.project.lockScreen.loadParts?.includes(part)) lines.push("- 取得入口: device.unlock_load_part");
    lines.push("");
  }
  for (const content of source.contents.filter(item => item.record.unlockCode && !item.record.unlockLoadParts?.length)) {
    lines.push(`- 追加取得なしのpassword: ${content.id}（本文所属: ${source.partOwnership.contents[content.id] ?? "base"}）`);
  }
  lines.push("");
}

function pushReadOnlyEndReview(lines, authoring, blockScope, talkFilters, fromFilter) {
  const ends = new Map();
  const add = (talk, block, source) => {
    if (!block || (talkFilters.length && !talkFilters.includes(talk))) return;
    if (!resolveScopedTalkBlockId(blockScope, talk, block)
      || authoring.flowRows.some(row => text(row, "talk") === talk && text(row, "from") === block)) return;
    const key = `${talk}/${block}`;
    ends.set(key, [...(ends.get(key) ?? []), source]);
  };
  if (!fromFilter) for (const talk of authoring.source.talks) {
    const block = talk.kind === "search_agent" ? outputStepNextFromKey(parseTalkOutputSteps(talk.startSteps).steps) : talk.startBlocks.at(-1);
    add(talk.id, block, "初期位置");
  }
  for (const row of authoring.flowRows) {
    if (text(row, "mode") || (fromFilter && text(row, "from") !== fromFilter)) continue;
    add(text(row, "talk"), outputStepNextFromKey(outputStepsForRow(row)), `talk_flow.tsv:${row.__rowNumber}`);
  }
  if (!ends.size) return;
  lines.push("## 読み取り専用の終点（確認用）", "",
    "以下はエラーではありません。返信を受け付けたい地点のdefault行が抜けていないか確認してください。検索AIも同じ仕様です。初期位置と通常遷移だけを列挙し、hookからの移動は含みません。", "");
  for (const [target, sources] of ends) lines.push(`- ${target}（到達元: ${sources.join("、")}）`);
  lines.push("");
}

function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const authoring = loadLocalTalkAuthoring(rootDir);
  const talkFilters = splitFilterList(args.get("talks") ?? args.get("talk") ?? "");
  const fromFilter = args.get("from") ?? "";
  const groupByFrom = flags.has("group-by-from");
  const outputPath = outputPathFor(args, talkFilters, fromFilter, groupByFrom);

  const peopleRows = authoring.peopleRows;
  const people = new Map(peopleRows.map((row) => [text(row, "id"), text(row, "name") || text(row, "id")]));
  people.set("search_agent", authoring.source.project?.assistantName || "search_agent");

  const flowRows = authoring.flowRows;
  const blockRows = authoring.blockRows;
  const errors = [];
  const blockScope = collectScopedTalkBlocks(blockRows, { onError: (message) => errors.push(message) });
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const targetRows = flowRows.filter((row) => {
    const talk = text(row, "talk");
    const from = text(row, "from");
    const outputSteps = outputStepsForRow(row);
    return (
      talk &&
      from &&
      outputSteps.length > 0 &&
      (!talkFilters.length || talkFilters.includes(talk)) &&
      (!fromFilter || from === fromFilter)
    );
  });

  const repeatRowsByBase = buildRepeatRowsByBase(blockScope);
  const initialStepsByTalk = new Map(
    (authoring.source.talks ?? [])
      .filter((talk) => talk?.kind === "search_agent")
      .map((talk) => [talk.id, parseTalkOutputSteps(talk.startSteps).steps])
  );
  const lines = [];
  lines.push("# talk_flow シナリオライター確認用");
  lines.push("");
  pushPartReview(lines, authoring, blockScope);
  pushReadOnlyEndReview(lines, authoring, blockScope, talkFilters, fromFilter);

  if (groupByFrom) {
    const { talks, rowsByTalk } = groupRowsByTalkAndFrom(targetRows);
    const incomingByTalkAndFrom = buildRepresentativeIncomingByTalkAndFrom(flowRows);
    pushGroupedReview(lines, rowsByTalk, talks, blockScope, people, repeatRowsByBase, incomingByTalkAndFrom, initialStepsByTalk);
    pushTalkBlockOnlyReviews(lines, blockScope, people, new Set(talks), talkFilters);
  } else {
    const { talks, rowsByTalk } = groupRowsByTalk(targetRows);
    pushFlatReview(lines, rowsByTalk, talks, blockScope, people, repeatRowsByBase, initialStepsByTalk);
    pushTalkBlockOnlyReviews(lines, blockScope, people, new Set(talks), talkFilters);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
  console.log(outputPath);
}

main();
