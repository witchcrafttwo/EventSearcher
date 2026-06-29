import { Hono } from "hono";
import { cors } from "hono/cors";
import { converse } from "./bedrock.js";
import { sha256Hex } from "./crypto.js";
import { isDiscoveryEnabled, webSearch } from "./discovery.js";
import { DynamoClient } from "./dynamo.js";
import { runIngest } from "./ingest.js";
import { matchesProfile } from "./matching.js";
import type { Env, EventRecord, PushSubscriptionRecord, UserProfile } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.post("/profiles", async (c) => {
  const body = await c.req.json<Partial<UserProfile>>();
  return c.json(await upsertProfile(c.env, body));
});

app.get("/profiles/:profileId/events", async (c) => {
  return c.json(await listEventsForProfile(c.env, c.req.param("profileId")));
});

app.post("/profiles/:profileId/subscriptions", async (c) => {
  const subscription = await c.req.json<PushSubscriptionRecord["subscription"]>();
  return c.json(await saveSubscription(c.env, c.req.param("profileId"), subscription));
});

app.post("/admin/ingest", async (c) => {
  return c.json(await runIngest(c.env));
});

// Bedrock接続の動作確認用。?q=... で任意プロンプトを送れる。
app.get("/admin/ai-test", async (c) => {
  const prompt = c.req.query("q") ?? "こんにちは。接続テストです。10文字以内で挨拶を返してください。";
  const text = await converse(c.env, prompt);
  return c.json({ modelId: c.env.BEDROCK_MODEL_ID, region: c.env.AWS_REGION, text });
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
  // Cron Triggers（wrangler.toml の crons）で定期ingestを実行
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runIngest(env).catch((error) => {
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
    area: String(input.area ?? "").trim() || "県内",
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
