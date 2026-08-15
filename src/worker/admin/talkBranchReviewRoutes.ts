import type { Context, Hono } from "hono";
import type { ServerEnv } from "../../server/store.ts";
import { isProductionEnvironment } from "../../server/environment.ts";
import { talkBranchReviewPageHtml } from "./talkBranchReviewPage.ts";
import {
  cleanId,
  cleanMessage,
  cleanStringArray,
  deleteTrialInputs,
  dismissJudgment,
  saveJudgment,
  simulateTalkBranchReviewSelection,
  replaceTalkBranchReviewClusters,
  talkBranchReviewAnalysisInputs,
  talkBranchReviewFromDetail,
  talkBranchReviewFromItems,
  talkBranchReviewReport,
  talkBranchReviewReportMarkdown,
  updateJudgment,
  updateJudgmentStatus
} from "./talkBranchReviewService.ts";

type AppContext = Context<ServerEnv>;

function dependencies(c: AppContext) {
  return c.var.dependencies;
}

function reviewSecret(c: AppContext) {
  return dependencies(c).config.adminReviewSecret?.trim() ?? "";
}

function providedSecret(c: AppContext) {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/iu, "").trim() ?? "";
  return (bearer || c.req.header("x-admin-review-secret")?.trim() || "").slice(0, 4096);
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorize(c: AppContext) {
  const expected = reviewSecret(c);
  if (!expected) {
    const hostname = new URL(c.req.url).hostname;
    const localRequest = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
    return localRequest && !isProductionEnvironment(dependencies(c).config.appEnv)
      ? { ok: true as const }
      : { ok: false as const, status: 503 as const, error: "admin_unavailable" };
  }
  const provided = providedSecret(c);
  if (!provided || provided.length !== expected.length) {
    return { ok: false as const, status: 401 as const, error: "unauthorized" };
  }
  const [providedHash, expectedHash] = await Promise.all([
    digest(`xstoryphone-review:v1:${provided}`),
    digest(`xstoryphone-review:v1:${expected}`)
  ]);
  return providedHash === expectedHash
    ? { ok: true as const }
    : { ok: false as const, status: 401 as const, error: "unauthorized" };
}

function isJudgmentStatus(value: string): value is "open" | "reported" | "applied" | "dismissed" {
  return value === "open" || value === "reported" || value === "applied" || value === "dismissed";
}

function cleanAnalysisClusters(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) return null;
  const clusters: Array<{
    id: string;
    fit: "blue" | "yellow" | "red";
    representativeInput: string;
    sourceEventIds: string[];
    reason: string;
  }> = [];
  let sourceCount = 0;
  for (const entry of value) {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const fit = cleanId(record.fit, 16);
    const normalizedFit: "blue" | "yellow" | "red" | null = fit === "blue" || fit === "yellow" || fit === "red" ? fit : null;
    const id = cleanId(record.id);
    const representativeInput = cleanMessage(record.representativeInput, 2_000);
    const sourceEventIds = cleanStringArray(record.sourceEventIds, 500);
    if (!id || !normalizedFit || !representativeInput || !sourceEventIds.length) return null;
    sourceCount += sourceEventIds.length;
    if (sourceCount > 1_000) return null;
    clusters.push({
      id,
      fit: normalizedFit,
      representativeInput,
      sourceEventIds,
      reason: cleanMessage(record.reason, 300)
    });
  }
  return clusters;
}

export function registerTalkBranchReviewRoutes(app: Hono<ServerEnv>) {
  app.get("/api/admin/talk-branch-review", () => new Response(talkBranchReviewPageHtml(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  }));

  app.get("/api/admin/talk-branch-review/froms", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    return c.json({ ok: true, items: await talkBranchReviewFromItems(dependencies(c).store) });
  });

  app.get("/api/admin/talk-branch-review/from", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const talkId = cleanId(c.req.query("talkId"));
    const fromId = cleanId(c.req.query("fromId"));
    const detail = await talkBranchReviewFromDetail(dependencies(c).store, talkId, fromId);
    return detail
      ? c.json({ ok: true, detail })
      : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.get("/api/admin/talk-branch-review/analysis-inputs", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const talkId = cleanId(c.req.query("talkId"));
    const fromId = cleanId(c.req.query("fromId"));
    const result = await talkBranchReviewAnalysisInputs(dependencies(c).store, talkId, fromId);
    return result
      ? c.json({ ok: true, ...result })
      : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.post("/api/admin/talk-branch-review/simulate", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const talkId = cleanId(body?.talkId);
    const fromId = cleanId(body?.fromId);
    const targetRuleId = cleanId(body?.targetRuleId);
    const message = cleanMessage(body?.message, 1_000);
    if (!talkId || !fromId || !targetRuleId || !message) {
      return c.json({ ok: false, error: "invalid_request" }, 400);
    }
    const result = await simulateTalkBranchReviewSelection(dependencies(c).config.llm, dependencies(c).store, { talkId, fromId, targetRuleId, message });
    return result.ok
      ? c.json({ ok: true, result: result.result })
      : c.json({ ok: false, error: result.error }, result.status);
  });

  app.post("/api/admin/talk-branch-review/clusters", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: false, error: "invalid_request" }, 400);
    const clusters = cleanAnalysisClusters(body.clusters);
    const input = {
      talkId: cleanId(body.talkId),
      fromId: cleanId(body.fromId),
      actualRuleId: cleanId(body.actualRuleId),
      scenarioRevision: cleanId(body.scenarioRevision),
      analysisVersion: cleanId(body.analysisVersion, 120)
    };
    if (!input.talkId || !input.fromId || !input.actualRuleId || !input.scenarioRevision || !input.analysisVersion || !clusters) {
      return c.json({ ok: false, error: "invalid_request" }, 400);
    }
    const result = await replaceTalkBranchReviewClusters(dependencies(c).store, { ...input, clusters });
    if (result.ok) return c.json({ ok: true });
    const status = result.error === "not_found" ? 404 : result.error === "revision_conflict" ? 409 : 400;
    return c.json({ ok: false, error: result.error }, status);
  });

  app.post("/api/admin/talk-branch-review/judgments", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: false, error: "invalid_request" }, 400);
    const scope = cleanId(body.scope, 32);
    const judgment = cleanId(body.judgment, 32);
    const talkId = cleanId(body.talkId);
    const fromId = cleanId(body.fromId);
    const validScope = ["branch", "criteria", "input_selection", "input"].includes(scope);
    const validJudgment = ["move_to_existing", "needs_new_branch", "hold", "comment_only"].includes(judgment);
    if (!validScope || !validJudgment || !talkId || !fromId) {
      return c.json({ ok: false, error: "invalid_request" }, 400);
    }
    const id = await saveJudgment(dependencies(c).store, {
      scope,
      judgment,
      talkId,
      fromId,
      sourceEventIds: cleanStringArray(body.sourceEventIds),
      clusterId: cleanId(body.clusterId) || null,
      actualRuleId: cleanId(body.actualRuleId) || null,
      expectedRuleId: cleanId(body.expectedRuleId) || null,
      comment: cleanMessage(body.comment, 2_000),
      newBranchNote: cleanMessage(body.newBranchNote, 2_000),
      reviewerLabel: cleanMessage(body.reviewerLabel, 120)
    });
    return c.json({ ok: true, id });
  });

  app.post("/api/admin/talk-branch-review/judgments/:id", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const id = cleanId(c.req.param("id"));
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const talkId = cleanId(body?.talkId);
    const fromId = cleanId(body?.fromId);
    if (!id || !body || !talkId || !fromId) return c.json({ ok: false, error: "invalid_request" }, 400);
    await updateJudgment(dependencies(c).store, talkId, fromId, id, {
      comment: cleanMessage(body.comment, 2_000),
      newBranchNote: cleanMessage(body.newBranchNote, 2_000),
      reviewerLabel: cleanMessage(body.reviewerLabel, 120)
    });
    return c.json({ ok: true });
  });

  app.post("/api/admin/talk-branch-review/judgments/:id/dismiss", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const id = cleanId(c.req.param("id"));
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const talkId = cleanId(body?.talkId);
    const fromId = cleanId(body?.fromId);
    if (!id || !talkId || !fromId) return c.json({ ok: false, error: "invalid_request" }, 400);
    await dismissJudgment(dependencies(c).store, talkId, fromId, id);
    return c.json({ ok: true });
  });

  app.post("/api/admin/talk-branch-review/judgments/:id/status", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const id = cleanId(c.req.param("id"));
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const status = cleanId(body?.status, 32);
    const talkId = cleanId(body?.talkId);
    const fromId = cleanId(body?.fromId);
    if (!id || !talkId || !fromId || !isJudgmentStatus(status)) return c.json({ ok: false, error: "invalid_request" }, 400);
    await updateJudgmentStatus(dependencies(c).store, talkId, fromId, id, status);
    return c.json({ ok: true });
  });

  app.post("/api/admin/talk-branch-review/trial-inputs/delete", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const talkId = cleanId(body?.talkId);
    const fromId = cleanId(body?.fromId);
    const ids = cleanStringArray(body?.ids);
    if (!talkId || !fromId || !ids.length) return c.json({ ok: false, error: "invalid_request" }, 400);
    const result = await deleteTrialInputs(dependencies(c).store, talkId, fromId, ids);
    return c.json({ ok: true, ...result });
  });

  app.get("/api/admin/talk-branch-review/report", async (c) => {
    const auth = await authorize(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const requested = cleanId(c.req.query("status"), 32);
    const status = isJudgmentStatus(requested) ? requested : "open";
    const report = await talkBranchReviewReport(dependencies(c).store, status);
    if (c.req.query("format") === "json") return c.json({ ok: true, report });
    return new Response(talkBranchReviewReportMarkdown(report), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  });
}
