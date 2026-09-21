import { text } from "./tsv-utils.mjs";
import { parseTalkFlowRegexCriteria } from "../../src/worker/product/talkFlowLlmSelection.ts";

function isDefaultRule(row) {
  return row.type === "default";
}

function isGameOver(row) {
  return text(row, "mode") === "game_over";
}

function photoTokens(value) {
  return [...String(value ?? "").matchAll(/photo:[a-zA-Z0-9_:-]+/gu)].map((match) => match[0]);
}

function hasPhotoToken(value) {
  return photoTokens(value).length > 0;
}

function compact(value, maxLength = 80) {
  const oneLine = String(value ?? "").replace(/\s+/gu, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}…` : oneLine;
}

function finding(severity, code, row, message, suggestion) {
  return {
    severity,
    code,
    row: row.__rowNumber,
    talk: text(row, "talk"),
    from: text(row, "from"),
    intent: text(row, "intent") || "default",
    message,
    suggestion,
    criteria: compact(row.criteria)
  };
}

export function auditTalkCriteria(rows) {
  const findings = [];
  const counters = {
    total: rows.length,
    normal: 0,
    default: 0,
    gameOver: 0,
    withPlayerSubject: 0,
    photoInputRules: 0
  };

  for (const row of rows) {
    const criteria = String(row.criteria ?? "").trim();
    const example = text(row, "example");
    const match = text(row, "match");
    const isDefault = isDefaultRule(row);
    const regexCriteria = row.type === "match" ? parseTalkFlowRegexCriteria(criteria) : { kind: "none" };
    const isPhotoRule = hasPhotoToken(example) || hasPhotoToken(match);

    if (isDefault) {
      counters.default += 1;
    } else {
      counters.normal += 1;
    }
    if (isGameOver(row)) {
      counters.gameOver += 1;
    }
    if (/プレイヤーが/u.test(criteria)) {
      counters.withPlayerSubject += 1;
    }
    if (isPhotoRule) {
      counters.photoInputRules += 1;
    }

    if (isDefault) {
      // 正規表現だけの場面ではLLM用contextを要求しない。
      const usesLlm = rows.some((candidate) => (
        text(candidate, "talk") === text(row, "talk")
        && [text(row, "from"), "*"].includes(text(candidate, "from"))
        && candidate.type === "ai"
      ));
      if (!usesLlm) continue;
      if (!criteria) {
        findings.push(
          finding(
            "error",
            "default_context_empty",
            row,
            "default rule の criteria が空で、current_context として場面前提を渡せません。",
            "現在の会話地点、相手が待っている入力、候補一覧だけでは分からない文脈を書く。"
          )
        );
      } else if (!/(通常候補|高確度|一致しない|曖昧|以外|ではなく|だけを通す|固定進行|分岐せず|待つ|聞き返し|話題逸れ|具体)/u.test(criteria)) {
        findings.push(
          finding(
            "warn",
            "default_boundary_weak",
            row,
            "default criteria に場面境界が見えにくく、通常候補より強く読まれる可能性があります。",
            "「通常候補に一致しない場合」「指定ID以外」「曖昧な返答」のような境界を足す。"
          )
        );
      }

      if (criteria.length > 240) {
        findings.push(
          finding(
            "info",
            "default_context_long",
            row,
            "default criteria が長めです。",
            "場面前提と選択全体の文脈だけに圧縮できるか確認する。"
          )
        );
      }
      continue;
    }

    if (regexCriteria.kind === "ready" || ((row.type === "match" || row.type === "secret") && !criteria.startsWith("/"))) {
      continue;
    }
    if (regexCriteria.kind === "invalid") {
      findings.push(
        finding(
          "error",
          "normal_criteria_regex_invalid",
          row,
          "criteria の正規表現が不正です。",
          "JavaScript の `/pattern/flags` 形式で書く。"
        )
      );
      continue;
    }

    if (isPhotoRule && !hasPhotoToken(criteria)) {
      findings.push(
        finding(
          "warn",
          "photo_rule_missing_photo_id",
          row,
          "photo: 入力を扱う rule ですが、criteria に photo ID がありません。",
          "criteria に `photo:...` を含め、指定IDか指定ID以外かを明示する。"
        )
      );
    }

    if (/(次へ|次に|固定進行|聞き返し|進める|反応にする|協力を頼む|問い詰める)/u.test(criteria)) {
      findings.push(
        finding(
          "warn",
          "normal_criteria_contains_response_or_flow",
          row,
          "通常 rule の criteria が返信内容や進行説明に寄っています。",
          "player_input に現れる行為、意図、対象だけに寄せる。返信本文は talk_blocks.body に置く。"
        )
      );
    }

    if (/^(証拠|写真|危険|説明|反応|肯定|否定|質問|確認)[。.\s]*$/u.test(criteria)) {
      findings.push(
        finding(
          "warn",
          "normal_criteria_too_generic",
          row,
          "criteria の対象が抽象的すぎます。",
          "どの証拠、どの写真、どの危険、どの質問なら選ぶかを書く。"
        )
      );
    }

    if (criteria.length > 90) {
      findings.push(
        finding(
          "info",
          "normal_criteria_long",
          row,
          "通常 rule の criteria が長めです。",
          "場面前提が混ざっていないか、選ぶ条件と選ばない条件に分けられるか確認する。"
        )
      );
    }

    if (isGameOver(row) && !/(明示|具体|予告|認め|名乗|自分|本人|高確度)/u.test(criteria)) {
      findings.push(
        finding(
          "warn",
          "game_over_boundary_weak",
          row,
          "game_over criteria に高確度条件が見えにくいです。",
          "引用、否定、冗談、低確信を除き、自分の発話として明示した場合だけ選ぶ条件にする。"
        )
      );
    }
  }

  const summary = {
    ...counters,
    findings: findings.length,
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warn").length,
    infos: findings.filter((item) => item.severity === "info").length
  };

  return { summary, findings };
}
