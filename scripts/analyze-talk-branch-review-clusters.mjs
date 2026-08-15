import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

const values = new Map();
const flags = new Set();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--") && arg.includes("=")) {
    const [key, value] = arg.slice(2).split(/=(.*)/su, 2);
    values.set(key, value);
  } else if (arg.startsWith("--")) {
    flags.add(arg.slice(2));
  }
}

if (flags.has("remote") || values.has("database")) {
  throw new Error("--remoteと--databaseは廃止しました。対象環境は--base-urlまたはREVIEW_BASE_URLで指定してください。");
}

const rootDir = process.cwd();
const listGroupsOnly = flags.has("list-groups");
const apply = flags.has("apply");
const applyFile = values.get("apply-file") ?? "";
const confirmedExternalLlm = flags.has("i-understand-this-sends-player-inputs-to-paid-llm");
if (!listGroupsOnly && !applyFile && !confirmedExternalLlm) {
  throw new Error("実プレイヤー入力を外部LLMへ送ります。実行する場合は --i-understand-this-sends-player-inputs-to-paid-llm を付けてください。");
}

function loadDevVars() {
  const filePath = path.join(rootDir, ".dev.vars");
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/gu, "");
  }
}

loadDevVars();

const scenario = loadAndValidateScenario();
const onlyTalk = values.get("talk") ?? "";
const onlyFrom = values.get("from") ?? "";
const onlyRule = values.get("rule") ?? "";
const limitGroups = Math.max(0, Number(values.get("limit-groups") ?? 0) || 0);
const limitEvents = Math.max(1, Math.min(500, Number(values.get("limit-events") ?? 500) || 500));
const timeoutMs = Math.max(1_000, Math.min(120_000, Number(values.get("timeout-ms") ?? 60_000) || 60_000));
const analysisVersion = values.get("analysis-version") ?? "talk_branch_review_llm_v1";
const outputPath = values.get("out") ?? path.join(rootDir, ".wrangler", "talk-branch-review-clusters.json");
const baseUrl = (values.get("base-url") || process.env.REVIEW_BASE_URL || "http://127.0.0.1:5173").replace(/\/+$/u, "");
const reviewSecret = process.env.ADMIN_REVIEW_SECRET?.trim() ?? "";

async function reviewApi(pathname, init = {}) {
  const headers = new Headers(init.headers);
  if (reviewSecret) headers.set("authorization", `Bearer ${reviewSecret}`);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`監修APIに失敗しました: HTTP ${response.status} / ${payload?.error ?? "invalid_response"}`);
  }
  return payload;
}

function cleanText(value, maxLength = 2_000) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function stableClusterId(parts) {
  return `cluster_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24)}`;
}

function fromIdsFor(talk) {
  return [...new Set(talk.rules.filter((rule) => rule.from !== "*").map((rule) => rule.from))];
}

function ruleFor(group) {
  const talk = scenario.worker.talks.find((item) => item.id === group.talkId);
  const rule = talk?.rules.find((item) => item.id === group.ruleId && (item.from === "*" || item.from === group.fromId));
  return talk && rule ? { talk, rule } : null;
}

function responsePreview(rule) {
  return rule.nextBlocks.flatMap((blockId) => {
    const block = scenario.worker.talkBlocks.find((item) => item.id === blockId);
    return (block?.messages ?? []).map((message) => {
      const person = scenario.worker.talkPeople.find((item) => item.id === message.sender);
      return `${person?.name ?? message.sender}: ${message.body || "[attachment]"}`;
    });
  }).slice(0, 12);
}

function normalizeClusters(raw, events) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const assigned = new Set();
  const clusters = [];
  const items = raw && typeof raw === "object" && Array.isArray(raw.clusters) ? raw.clusters : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const sourceEventIds = Array.isArray(item.event_ids)
      ? item.event_ids.filter((id) => typeof id === "string" && byId.has(id) && !assigned.has(id))
      : [];
    if (!sourceEventIds.length) continue;
    sourceEventIds.forEach((id) => assigned.add(id));
    const fit = ["blue", "yellow", "red"].includes(item.fit) ? item.fit : "yellow";
    const representativeInput = cleanText(item.representative_input) || byId.get(sourceEventIds[0])?.input || "";
    clusters.push({ sourceEventIds, fit, representativeInput, reason: cleanText(item.reason, 300) });
  }
  for (const event of events) {
    if (!assigned.has(event.id)) {
      clusters.push({
        sourceEventIds: [event.id],
        fit: "yellow",
        representativeInput: event.input,
        reason: "LLMの出力に含まれなかった入力"
      });
    }
  }
  return clusters;
}

async function analyzeGroup(group, events, resolved) {
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  const model = process.env.LLM_MODEL?.trim() ?? "";
  const llmBaseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/u, "");
  if (!apiKey || !model) throw new Error("LLM_API_KEY と LLM_MODEL を設定してください。");
  const response = await fetch(`${llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            "あなたは会話分岐レビュー用の入力整理係です。",
            "実入力を意味が近いもの同士でゆるくクラスタリングしてください。",
            "fitは、現在の分岐条件と返答に対し、blue=問題なさそう、yellow=少しあやしい、red=合っていなさそう、です。",
            "判定はレビューの手がかりであり、断定しないでください。",
            "event_idsは与えられたIDだけを使い、各IDを1つのクラスタに入れてください。",
            "返信文や新しい分岐本文を生成してはいけません。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            talk: resolved.talk.label,
            fromId: group.fromId,
            branch: {
              intent: resolved.rule.intent || "default",
              criteria: resolved.rule.isDefault ? "他の条件に高確度で一致しない入力" : resolved.rule.criteria,
              notes: resolved.rule.notes,
              responsePreview: responsePreview(resolved.rule)
            },
            inputs: events.map((event) => ({ id: event.id, text: event.input }))
          })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "talk_branch_review_clusters",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              clusters: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    representative_input: { type: "string" },
                    fit: { type: "string", enum: ["blue", "yellow", "red"] },
                    event_ids: { type: "array", minItems: 1, items: { type: "string" } },
                    reason: { type: "string" }
                  },
                  required: ["representative_input", "fit", "event_ids", "reason"]
                }
              }
            },
            required: ["clusters"]
          }
        }
      },
      max_completion_tokens: 4_096
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`LLM集計に失敗しました: HTTP ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM応答にJSON本文がありません。");
  return normalizeClusters(JSON.parse(content.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")), events);
}

async function loadGroups() {
  const groups = [];
  for (const talk of scenario.worker.talks) {
    if (onlyTalk && talk.id !== onlyTalk) continue;
    for (const fromId of fromIdsFor(talk)) {
      if (onlyFrom && fromId !== onlyFrom) continue;
      const params = new URLSearchParams({ talkId: talk.id, fromId });
      const payload = await reviewApi(`/api/admin/talk-branch-review/analysis-inputs?${params}`);
      if (payload.scenarioRevision !== scenario.worker.revision) {
        throw new Error(`シナリオリビジョンが一致しません: local=${scenario.worker.revision} server=${payload.scenarioRevision}`);
      }
      const grouped = new Map();
      for (const event of payload.events ?? []) {
        if (onlyRule && event.ruleId !== onlyRule) continue;
        const input = cleanText(event.userInput);
        if (!event.id || !event.ruleId || !input) continue;
        grouped.set(event.ruleId, [...(grouped.get(event.ruleId) ?? []), { id: event.id, input }]);
      }
      for (const [ruleId, events] of grouped) {
        groups.push({ talkId: talk.id, fromId, ruleId, events: events.slice(0, limitEvents) });
      }
    }
  }
  return limitGroups ? groups.slice(0, limitGroups) : groups;
}

function validateAnalysisFile(value) {
  if (!value || value.formatVersion !== 1 || value.scenarioRevision !== scenario.worker.revision || !Array.isArray(value.groups)) {
    throw new Error("集計JSONの形式またはシナリオリビジョンが一致しません。");
  }
  return value;
}

async function applyAnalysis(value) {
  for (const [index, group] of value.groups.entries()) {
    console.log(`[${index + 1}/${value.groups.length}] 集計結果を保存: ${group.talkId} / ${group.fromId} / ${group.actualRuleId}`);
    await reviewApi("/api/admin/talk-branch-review/clusters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        talkId: group.talkId,
        fromId: group.fromId,
        actualRuleId: group.actualRuleId,
        scenarioRevision: value.scenarioRevision,
        analysisVersion: value.analysisVersion,
        clusters: group.clusters
      })
    });
  }
}

if (applyFile) {
  const analysis = validateAnalysisFile(JSON.parse(fs.readFileSync(path.resolve(rootDir, applyFile), "utf8")));
  await applyAnalysis(analysis);
  console.log(`${analysis.groups.length}グループの集計結果を監修APIへ反映しました。`);
} else {
  const groups = await loadGroups();
  if (listGroupsOnly) {
    console.table(groups.map((group) => ({ talk: group.talkId, from: group.fromId, rule: group.ruleId, inputs: group.events.length })));
  } else {
    const analysis = {
      formatVersion: 1,
      scenarioRevision: scenario.worker.revision,
      analysisVersion,
      generatedAt: new Date().toISOString(),
      groups: []
    };
    for (const [index, group] of groups.entries()) {
      const resolved = ruleFor(group);
      if (!resolved) {
        console.warn(`未定義の分岐を省略: ${group.talkId} / ${group.fromId} / ${group.ruleId}`);
        continue;
      }
      console.log(`[${index + 1}/${groups.length}] ${resolved.talk.label} / ${resolved.rule.intent || "default"} (${group.events.length})`);
      const clusters = await analyzeGroup(group, group.events, resolved);
      analysis.groups.push({
        talkId: group.talkId,
        fromId: group.fromId,
        actualRuleId: group.ruleId,
        clusters: clusters.map((cluster) => ({
          id: stableClusterId([
            scenario.worker.revision,
            group.talkId,
            group.fromId,
            group.ruleId,
            cluster.representativeInput,
            ...cluster.sourceEventIds
          ]),
          ...cluster
        }))
      });
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
    console.log(`${analysis.groups.length}グループの集計JSONを保存しました: ${outputPath}`);
    if (apply) {
      await applyAnalysis(analysis);
      console.log("集計結果を監修APIへ反映しました。");
    } else {
      console.log(`内容を確認後、--apply-file=${path.relative(rootDir, outputPath)} で監修APIへ反映できます。`);
    }
  }
}
