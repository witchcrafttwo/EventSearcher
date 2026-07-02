import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import { sha256Hex } from "./crypto.js";
import { DynamoClient } from "./dynamo.js";
import { isDiscoveryEnabled, webSearch } from "./discovery.js";
import { debugEnrich, enrichCandidate } from "./event-ai.js";
import { clearEvents, previewIngest, runIngest, runScheduledIngest } from "./ingest.js";
import { chat } from "./llm.js";
import { matchesProfile } from "./matching.js";
import { buildAiText, fetchPageText } from "./page.js";
import { setupTables } from "./setup.js";
import { fetchCandidates } from "./source-fetcher.js";
import { addSource, deleteSource, listSources, loadAllSources, setSourceEnabled } from "./sources.js";
import type { Env, EventRecord, PushSubscriptionRecord, RawEventCandidate, UserProfile } from "./types.js";

const app = new Hono<{ Bindings: Env }>();
export { app };

app.use("*", cors());

// 管理系API(/admin/*, /sources*)はトークン保護。ADMIN_TOKEN未設定なら素通り(ローカル開発用)。
const adminAuth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const token = c.env.ADMIN_TOKEN;
  if (token && c.req.header("authorization") !== `Bearer ${token}`) {
    return c.json({ message: "unauthorized" }, 401);
  }
  await next();
};
app.use("/admin/*", adminAuth);
app.use("/sources", adminAuth);
app.use("/sources/*", adminAuth);

app.get("/health", (c) => c.json({ ok: true }));

app.post("/profiles", async (c) => {
  const body = await c.req.json<Partial<UserProfile>>();
  return c.json(await upsertProfile(c.env, body));
});

app.get("/profiles/:profileId/events", async (c) => {
  return c.json(await listEventsForProfile(c.env, c.req.param("profileId")));
});

// エリアで検索（市を選んでイベント一覧を取得）。?area=松山市 、未指定なら全件
app.get("/events", async (c) => {
  const area = (c.req.query("area") ?? "").trim();
  const ddb = new DynamoClient(c.env);
  const events = await ddb.query<EventRecord>({
    tableName: c.env.EVENTS_TABLE,
    indexName: "publishedAtIndex",
    keyConditionExpression: "eventType = :eventType",
    expressionAttributeValues: { ":eventType": "event" },
    scanIndexForward: false,
    limit: 200
  });
  const disabled = await buildDisabledMatcher(c.env);
  const filtered = events
    .filter((e) => !disabled(e)) // OFFのサイトは表示しない
    .filter((e) => {
      if (!area) return true;
      const ea = (e.area ?? "").trim();
      return ea !== "" && (ea.includes(area) || area.includes(ea));
    });
  return c.json({ events: filtered.slice(0, 100) });
});

// エリア選択肢: 表示対象(ON)のイベントから重複なしのエリア一覧を返す
app.get("/areas", async (c) => {
  const ddb = new DynamoClient(c.env);
  const events = await ddb.scanAll<EventRecord>(c.env.EVENTS_TABLE);
  const disabled = await buildDisabledMatcher(c.env);
  const areas = [
    ...new Set(
      events
        .filter((e) => !disabled(e))
        .map((e) => (e.area ?? "").trim())
        .filter(Boolean)
    )
  ].sort();
  return c.json({ areas });
});

app.post("/profiles/:profileId/subscriptions", async (c) => {
  const subscription = await c.req.json<PushSubscriptionRecord["subscription"]>();
  return c.json(await saveSubscription(c.env, c.req.param("profileId"), subscription));
});

// スクレイピング+AI要約の動作確認用（DB不要）。?limit=件数 で要約する件数を指定。
app.get("/admin/scrape-test", async (c) => {
  const candidates = await fetchCandidates(await loadAllSources(c.env));
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 3), 1), 10);
  const sample = [];
  for (const candidate of candidates.slice(0, limit)) {
    const enriched = await enrichCandidate(c.env, candidate);
    if (enriched) sample.push(enriched);
  }
  return c.json({ found: candidates.length, titles: candidates.map((x) => x.title).slice(0, 30), sample });
});

app.post("/admin/ingest", async (c) => {
  const force = c.req.query("force") === "true";
  const limitParam = Number(c.req.query("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
  const sourceId = c.req.query("sourceId") || undefined;
  return c.json(await runIngest(c.env, { force, limit, sourceId }));
});

// eventsテーブルを空にする（再収集前のリセット）
app.post("/admin/clear-events", async (c) => {
  return c.json(await clearEvents(c.env));
});

// Vercel Cron 用の定期収集トリガ（GET）。CRON_SECRET を設定した場合は Bearer 一致を要求。
// Vercel は CRON_SECRET を設定すると Authorization: Bearer <CRON_SECRET> を自動付与する。
app.get("/cron/ingest", async (c) => {
  const secret = c.env.CRON_SECRET;
  if (secret && c.req.header("authorization") !== `Bearer ${secret}`) {
    return c.json({ message: "unauthorized" }, 401);
  }
  c.executionCtx.waitUntil(
    runScheduledIngest(c.env).catch((error) => console.error("cron ingest failed", error))
  );
  return c.json({ ok: true, started: true });
});

// 初期セットアップ: DynamoDBテーブルを3つ作成（冪等）
app.post("/admin/setup-tables", async (c) => {
  return c.json(await setupTables(c.env));
});

// 情報源URLの管理（フロントのパネルから操作）
app.get("/sources", async (c) => {
  return c.json({ sources: await listSources(c.env) });
});

// ingestが実際に使う最終ソース一覧（ファイル+DB+env のマージ結果、AI無し）
app.get("/admin/sources-all", async (c) => {
  return c.json({ sources: await loadAllSources(c.env) });
});

app.post("/sources", async (c) => {
  const body = await c.req.json<{ url?: string; name?: string; area?: string; type?: string }>();
  return c.json({ source: await addSource(c.env, body) });
});

app.delete("/sources/:id", async (c) => {
  return c.json(await deleteSource(c.env, c.req.param("id")));
});

// ソースのON/OFF切替
app.patch("/sources/:id", async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>();
  return c.json({ source: await setSourceEnabled(c.env, c.req.param("id"), body.enabled !== false) });
});

// DB不要の動作確認: 取得→AI要約 の結果だけ返す。?limit=3
app.get("/admin/ingest-preview", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 3, 1), 10);
  return c.json(await previewIngest(c.env, limit));
});

// デバッグ: 単一URLをスクレイプして候補(AI無し)を返す。?url=...
app.get("/admin/scrape-url", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ message: "url query required" }, 400);
  const type = /\.(xml|rss)(\?|$)|\/(feed|rss)\b/i.test(url) ? "rss" : "html";
  const candidates = await fetchCandidates([{ id: "debug", name: "debug", url, area: "", type }]);
  return c.json({
    found: candidates.length,
    candidates: candidates.slice(0, 40).map((x) => ({ title: x.title, url: x.url }))
  });
});
// デバッグ: 先頭候補の生AI出力を返す（フォールバック原因の特定用）
app.get("/admin/ai-debug", async (c) => {
  const url = c.req.query("url");
  if (url) {
    const text = await fetchPageText(url);
    const candidate = { sourceId: "debug", sourceName: "debug", sourceUrl: url, title: "debug", url, area: "", snippet: buildAiText(text), publishedAt: new Date().toISOString() };
    return c.json(await debugEnrich(c.env, candidate));
  }
  const candidates = await fetchCandidates(await loadAllSources(c.env));
  if (candidates.length === 0) return c.json({ message: "no candidates" });
  const hydrated = await hydrateForDebug(candidates[0]);
  return c.json(await debugEnrich(c.env, hydrated));
});

// Bedrock接続の動作確認用。?q=... で任意プロンプトを送れる。
app.get("/admin/ai-test", async (c) => {
  const prompt = c.req.query("q") ?? "こんにちは。接続テストです。10文字以内で挨拶を返してください。";
  const text = await chat(c.env, prompt);
  return c.json({ provider: c.env.AI_PROVIDER ?? "bedrock", model: c.env.AI_PROVIDER === "openai" ? c.env.LLM_MODEL : c.env.BEDROCK_MODEL_ID, text });
});

// AgentCore Web Search の動作確認用。?q=検索語 で検索結果を返す。
app.get("/admin/search-test", async (c) => {
  if (!isDiscoveryEnabled(c.env)) {
    return c.json({ enabled: false, message: "AgentCore Web Search の設定が未完了です" });
  }
  const query = c.req.query("q") ?? "新潟県 子ども イベント";
  const results = await webSearch(c.env, query, 5);
  return c.json({ enabled: true, query, results });
});

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return c.json({ message }, 500);
});

export default {
  fetch: app.fetch,
  // Cron Triggers（wrangler.toml の crons）で定期ingestを実行（1ソースずつ）
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduledIngest(env).catch((error) => {
        console.error("scheduled ingest failed", error);
      })
    );
  }
};

async function upsertProfile(env: Env, input: Partial<UserProfile>): Promise<{ profile: UserProfile }> {
  const now = new Date().toISOString();
  const profile: UserProfile = {
    profileId: input.profileId || crypto.randomUUID(),
    childAge: clampNumber(input.childAge, 0, 18),
    interests: normalizeStringArray(input.interests),
    area: String(input.area ?? "").trim(),
    notificationLeadDays: clampNumber(input.notificationLeadDays ?? 45, 1, 180),
    createdAt: input.createdAt || now,
    updatedAt: now
  };

  const ddb = new DynamoClient(env);
  await ddb.putItem(env.PROFILES_TABLE, profile);
  return { profile };
}

async function listEventsForProfile(env: Env, profileId: string): Promise<{ events: EventRecord[] }> {
  const ddb = new DynamoClient(env);
  const profile = await ddb.getItem<UserProfile>(env.PROFILES_TABLE, { profileId });
  if (!profile) return { events: [] };

  const events = await ddb.query<EventRecord>({
    tableName: env.EVENTS_TABLE,
    indexName: "publishedAtIndex",
    keyConditionExpression: "eventType = :eventType",
    expressionAttributeValues: { ":eventType": "event" },
    scanIndexForward: false,
    limit: 100
  });

  return {
    events: events.filter((item) => matchesProfile(item, profile)).slice(0, 50)
  };
}

async function saveSubscription(
  env: Env,
  profileId: string,
  subscription: PushSubscriptionRecord["subscription"]
): Promise<{ ok: true }> {
  if (!profileId) throw new Error("profileId is required");
  if (!subscription?.endpoint || !subscription.keys?.auth || !subscription.keys?.p256dh) {
    throw new Error("Invalid push subscription");
  }

  const now = new Date().toISOString();
  const record: PushSubscriptionRecord = {
    profileId,
    endpointHash: await sha256Hex(subscription.endpoint),
    subscription,
    createdAt: now,
    updatedAt: now
  };

  const ddb = new DynamoClient(env);
  await ddb.putItem(env.SUBSCRIPTIONS_TABLE, record);
  return { ok: true };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [];
}

function clampNumber(value: unknown, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(Math.trunc(numeric), min), max);
}

/** OFFソース判定: sourceId一致 or URLのホスト名一致で非表示にする（過去データのid不一致にも対応） */
async function buildDisabledMatcher(env: Env): Promise<(event: EventRecord) => boolean> {
  const sources = await loadAllSources(env);
  const disabled = sources.filter((s) => s.enabled === false);
  const ids = new Set(disabled.map((s) => s.id));
  const hosts = new Set(disabled.map((s) => hostOf(s.url)).filter(Boolean));
  return (event) => ids.has(event.sourceId) || hosts.has(hostOf(event.url));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function hydrateForDebug(candidate: RawEventCandidate): Promise<RawEventCandidate> {
  const text = await fetchPageText(candidate.url);
  return text ? { ...candidate, snippet: buildAiText(text) } : candidate;
}
