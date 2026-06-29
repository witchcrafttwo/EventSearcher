import { sha256Hex } from "./crypto.js";
import { discoverCandidates, isDiscoveryEnabled } from "./discovery.js";
import { DynamoClient } from "./dynamo.js";
import { enrichCandidate } from "./event-ai.js";
import { matchesProfile } from "./matching.js";
import { fetchCandidates } from "./source-fetcher.js";
import type { Env, EventRecord, EventSourceConfig, PushSubscriptionRecord, UserProfile } from "./types.js";

export async function runIngest(env: Env): Promise<{ saved: number; notified: number }> {
  const ddb = new DynamoClient(env);

  // AgentCore Web Search が設定済みなら自動発見、未設定なら従来のURLリストを使う
  const candidates = isDiscoveryEnabled(env)
    ? await discoverCandidates(env)
    : await fetchCandidates(parseSources(env.EVENT_SOURCES_JSON ?? "[]"));

  const profiles = await ddb.scanAll<UserProfile>(env.PROFILES_TABLE);
  const subscriptions = await ddb.scanAll<PushSubscriptionRecord>(env.SUBSCRIPTIONS_TABLE);

  const newEvents: EventRecord[] = [];
  for (const candidate of candidates) {
    const eventId = await createEventId(candidate.sourceId, candidate.url, candidate.title);
    const exists = await ddb.getItem<EventRecord>(env.EVENTS_TABLE, { eventId });
    if (exists) continue;

    const enriched = await enrichCandidate(env, candidate);
    const event: EventRecord = {
      ...enriched,
      eventId,
      eventType: "event",
      createdAt: new Date().toISOString()
    };

    await ddb.putItem(env.EVENTS_TABLE, event, "attribute_not_exists(eventId)");
    newEvents.push(event);
  }

  const notified = await notifyMatches(env, newEvents, profiles, subscriptions);
  return { saved: newEvents.length, notified };
}

function parseSources(value: string): EventSourceConfig[] {
  const parsed = JSON.parse(value) as EventSourceConfig[];
  return parsed.filter((source) => source.id && source.url && source.type);
}

async function notifyMatches(
  env: Env,
  events: EventRecord[],
  profiles: UserProfile[],
  subscriptions: PushSubscriptionRecord[]
): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || events.length === 0) return 0;

  // TODO: Web Push 送信。Node依存の `web-push` は Workers で動かないため、
  // Web Crypto ベースの実装（例: @block65/webcrypto-web-push）に差し替える。
  // マッチ判定までは行い、送信件数は実装後に返す。
  let matchedSubscriptions = 0;
  for (const profile of profiles) {
    const matched = events.some((event) => matchesProfile(event, profile));
    if (!matched) continue;
    matchedSubscriptions += subscriptions.filter((sub) => sub.profileId === profile.profileId).length;
  }
  void matchedSubscriptions; // 送信実装までは未使用
  return 0;
}

function createEventId(sourceId: string, url: string, title: string): Promise<string> {
  return sha256Hex(`${sourceId}:${url}:${title}`);
}
