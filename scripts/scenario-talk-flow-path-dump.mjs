import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { collectScopedTalkBlocks, resolveScopedTalkBlockId } from "./lib/talk-blocks.mjs";
import { formatTalkOutputStep, parseTalkOutputSteps } from "./lib/talk-output-steps.mjs";
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

function lastVisibleMessage(rows) {
  return [...(rows ?? [])].reverse().find((row) => visibleText(row.body) || text(row, "attachment"));
}

function modeLabel(row) {
  const mode = text(row, "mode");
  if (mode) {
    return mode;
  }
  return "advance";
}

function outputPathFor(args, talk, from) {
  const explicit = args.get("output");
  if (explicit) {
    return path.resolve(rootDir, explicit);
  }
  const safeTalk = talk.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_");
  const safeFrom = from ? `-${from.replace(/[^\p{Letter}\p{Number}_-]+/gu, "_")}` : "";
  return path.join("/private/tmp", `xstoryphone-talk-flow-paths-${safeTalk}${safeFrom}.md`);
}

function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const authoring = loadLocalTalkAuthoring(rootDir);
  const talk = args.get("talk") ?? authoring.source.talks?.[0]?.id ?? "";
  const talkSource = authoring.source.talks?.find((item) => item?.id === talk);
  const fromFilter = args.get("from") ?? "";
  const multiNextOnly = flags.has("multi-next-only");
  const outputPath = outputPathFor(args, talk, fromFilter);

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
    if (text(row, "talk") !== talk) {
      return false;
    }
    if (fromFilter && text(row, "from") !== fromFilter) {
      return false;
    }
    const outputSteps = parseTalkOutputSteps(row.next).steps;
    return outputSteps.length > 0 && (!multiNextOnly || outputSteps.length > 1);
  });

  const lines = [];
  lines.push(`# talk_flow パス目視用ダンプ`);
  lines.push("");
  lines.push(`- talk: \`${talk}\``);
  if (fromFilter) {
    lines.push(`- from: \`${fromFilter}\``);
  }
  if (talkSource?.kind === "search_agent") {
    const startSteps = parseTalkOutputSteps(talkSource.startSteps).steps;
    lines.push(`- startSteps: ${startSteps.map((step) => `\`${formatTalkOutputStep(step)}\``).join(" -> ")}`);
  }
  if (multiNextOnly) {
    lines.push("- 対象: next が複数 step の rule のみ");
  }
  lines.push("- 読み順: from最後の発言 -> プレイヤーexample -> next step連結");
  lines.push("");

  for (const [index, row] of targetRows.entries()) {
    const from = text(row, "from");
    const intent = text(row, "intent") || "default";
    const example = visibleText(row.example);
    const outputSteps = parseTalkOutputSteps(row.next).steps;
    const fromBlockId = resolveScopedTalkBlockId(blockScope, talk, from);
    const fromRows = blockScope.blocks.get(fromBlockId) ?? [];
    const fromLast = lastVisibleMessage(fromRows);

    lines.push(`## ${index + 1}. ${from} / ${intent}`);
    lines.push("");
    lines.push(`- talk_flow row: ${row.__rowNumber}`);
    lines.push(`- mode: ${modeLabel(row)}`);
    lines.push(`- next: ${outputSteps.map((step) => `\`${formatTalkOutputStep(step)}\``).join(" -> ")}`);
    lines.push("");
    lines.push("### from最後");
    lines.push("");
    if (fromLast) {
      lines.push(formatMessage(fromLast, people));
    } else {
      lines.push(`(from block \`${from}\` の表示発言なし、または未定義)`);
    }
    lines.push("");
    lines.push("### プレイヤーexample");
    lines.push("");
    lines.push(example ? `プレイヤー: ${oneLine(example)}` : "(example なし)");
    lines.push("");
    lines.push("### next連結");
    lines.push("");

    for (const step of outputSteps) {
      if (step.kind === "search") {
        lines.push(`#### [検索] ${step.queryTemplate}`);
        lines.push("");
        continue;
      }
      if (step.kind === "input") {
        lines.push(`#### [入力] ${step.action}`);
        lines.push("");
        continue;
      }
      const blockKey = step.blockKey;
      const blockId = resolveScopedTalkBlockId(blockScope, talk, blockKey);
      const rows = blockScope.blocks.get(blockId);
      lines.push(`#### ${step.kind === "if" ? `[条件: ${step.cond}] ` : ""}${blockKey}`);
      lines.push("");
      if (!rows) {
        lines.push(`(block \`${blockKey}\` が見つかりません)`);
        lines.push("");
        continue;
      }
      for (const messageRow of rows) {
        lines.push(formatMessage(messageRow, people));
        lines.push("");
      }
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
  console.log(outputPath);
}

main();
