import { DynamoClient } from "./dynamo.js";
import type { Env, EventRecord, PushSubscriptionRecord, UserProfile } from "./types.js";

/**
 * Web Push の配信処理。収集処理から完全に分離してある。
 *
 * 収集は「未通知」として保存するだけで送信しない（notifiedAt が未設定＝未通知）。
 * この処理を日本時間19時に1日1回起動し、未通知イベントをまとめて送る。
 * 22:00〜08:00(JST) は通知禁止時間帯として送信せず、未通知のまま保留する。
 *
 * 重要: 実行環境（Vercel等）は多くがUTC動作なので、時刻判定は必ず日本時間へ変換して行う。
 */

const DEFAULT_NOTIFY_HOUR = 19;
const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 8;
const DEFAULT_STALE_DAYS = 7;

export type NotifyResult = {
  /** 送信した Push の件数（購読単位） */
  sent: number;
  /** 送信に失敗した件数 */
  failed: number;
  /** 失効として削除した購読の件数 */
  removedSubscriptions: number;
  /** 通知済みに更新したイベント件数 */
  markedEvents: number;
  /** 滞留として送信せず打ち切ったイベント件数 */
  staleSkipped: number;
  /** 対象だった未通知イベント件数 */
  pending: number;
  /** 通知禁止時間帯などで送信せずに終了した場合の理由 */
  skipped?: "quiet-hours" | "not-configured" | "no-pending" | "no-subscriptions";
  /** 判定に使った日本時間 */
  jst: string;
};

/** 日本時間の時・日付を取得する（実行環境のタイムゾーンに依存しない） */
export function jstParts(now: Date = new Date()): { hour: number; iso: string } {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  return {
    hour: jst.getUTCHours(),
    iso: `${jst.toISOString().slice(0, 19).replace("T", " ")} JST`
  };
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 通知禁止時間帯かどうか。既定は22:00以降08:00未満（日付をまたぐ範囲）。
 */
export function isQuietHours(env: Env, now: Date = new Date()): boolean {
  const start = intFromEnv(env.QUIET_START_HOUR_JST, DEFAULT_QUIET_START);
  const end = intFromEnv(env.QUIET_END_HOUR_JST, DEFAULT_QUIET_END);
  const { hour } = jstParts(now);
  // start > end のときは日付をまたぐ（例: 22時〜翌8時）
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** 設定された通知配信時刻（日本時間の時）。既定19時。 */
export function notifyHourJst(env: Env): number {
  return intFromEnv(env.NOTIFY_HOUR_JST, DEFAULT_NOTIFY_HOUR);
}

/** イベントが開催終了済みか（終了日、無ければ開催日が今日より前） */
function isFinished(event: EventRecord, now: Date): boolean {
  const end = event.eventEndDate ?? event.eventDate;
  if (!end) return false; // 日付不明は終了扱いにしない
  const t = new Date(end);
  if (Number.isNaN(t.getTime())) return false;
  // 日本時間の今日の0時と比較する
  const todayJst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  todayJst.setUTCHours(0, 0, 0, 0);
  return t.getTime() < todayJst.getTime() - 9 * 60 * 60 * 1000;
}

/** 保存から staleDays を超えて未通知のままのイベントか */
function isStale(event: EventRecord, now: Date, staleDays: number): boolean {
  const base = event.createdAt ?? event.publishedAt;
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > staleDays * 24 * 60 * 60 * 1000;
}

/** 通知用のマッチ判定: エリア（部分一致）＋カテゴリ（選択したものに含まれるか）。未設定は全件対象。 */
export function matchesForNotification(event: EventRecord, profile?: UserProfile): boolean {
  if (!profile) return true;
  const area = (profile.area ?? "").trim();
  const eventArea = (event.area ?? "").trim();
  if (area && eventArea && !(eventArea.includes(area) || area.includes(eventArea))) return false;
  const categories = profile.interests ?? [];
  if (categories.length > 0) {
    if (!event.category || !categories.includes(event.category)) return false;
  }
  return true;
}

/**
 * 未通知イベントをまとめて配信する。
 * force=true で通知禁止時間帯のチェックを飛ばす（管理画面からの手動テスト用）。
 */
export async function runNotify(
  env: Env,
  options: { force?: boolean } = {}
): Promise<NotifyResult> {
  const now = new Date();
  const { iso: jst } = jstParts(now);
  const result: NotifyResult = {
    sent: 0,
    failed: 0,
    removedSubscriptions: 0,
    markedEvents: 0,
    staleSkipped: 0,
    pending: 0,
    jst
  };

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.log(`[notify] VAPID未設定のため送信しません (${jst})`);
    return { ...result, skipped: "not-configured" };
  }

  const ddb = new DynamoClient(env);
  const allEvents = await ddb.scanAll<EventRecord>(env.EVENTS_TABLE);
  const staleDays = intFromEnv(env.NOTIFY_STALE_DAYS, DEFAULT_STALE_DAYS);

  // 未通知のイベントを抽出。終了済みは対象外、滞留分は送らず通知済みにして解消する。
  const pending: EventRecord[] = [];
  const staleOrFinished: EventRecord[] = [];
  for (const event of allEvents) {
    if (event.eventType !== "event") continue;
    if (event.notifiedAt) continue; // 送信済みは再送しない
    if (isFinished(event, now) || isStale(event, now, staleDays)) {
      staleOrFinished.push(event);
      continue;
    }
    pending.push(event);
  }
  result.pending = pending.length;

  // 通知禁止時間帯は送信しない。未通知のまま保留し、明けてからまとめて送る。
  if (!options.force && isQuietHours(env, now)) {
    console.log(`[notify] 通知禁止時間帯のため送信を保留 (${jst}) 保留${pending.length}件`);
    return { ...result, skipped: "quiet-hours" };
  }

  // 終了済み・滞留は送信せず通知済みにして保留を解消する（送信可能な時間帯のみ実施）
  for (const event of staleOrFinished) {
    await markNotified(env, ddb, event).catch(() => undefined);
    result.staleSkipped++;
  }

  if (pending.length === 0) {
    console.log(`[notify] 未通知イベントなし (${jst}) 滞留解消${result.staleSkipped}件`);
    return { ...result, skipped: "no-pending" };
  }

  const subscriptions = await ddb.scanAll<PushSubscriptionRecord>(env.SUBSCRIPTIONS_TABLE);
  if (subscriptions.length === 0) {
    console.log(`[notify] 購読者がいないため送信しません (${jst})`);
    return { ...result, skipped: "no-subscriptions" };
  }

  // web-push は Node ライブラリ。変数指定の動的importにして、Node以外の環境で
  // バンドル/実行時に巻き込まれないようにする。
  let webpush: any;
  try {
    const moduleName = "web-push";
    webpush = (await import(moduleName)).default ?? (await import(moduleName));
    webpush.setVapidDetails(
      env.VAPID_SUBJECT || "mailto:noreply@example.com",
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );
  } catch {
    console.log(`[notify] web-push が使えないため送信しません (${jst})`);
    return { ...result, skipped: "not-configured" };
  }

  const profiles = await ddb.scanAll<UserProfile>(env.PROFILES_TABLE);
  const profileById = new Map(profiles.map((p) => [p.profileId, p]));

  // 実際に誰かへ送れたイベントだけを通知済みにする（誰にも一致しなければ次回に回す）
  const deliveredEventIds = new Set<string>();

  for (const sub of subscriptions) {
    const profile = profileById.get(sub.profileId);
    const matched = pending.filter((event) => matchesForNotification(event, profile));
    if (matched.length === 0) continue;

    const first = matched[0];
    const payload = JSON.stringify({
      title: "えひめイベントナビ",
      body: matched.length === 1 ? first.title : `「${first.title}」など新着イベント${matched.length}件`,
      url: "/"
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.subscription.endpoint, keys: sub.subscription.keys },
        payload
      );
      result.sent++;
      for (const event of matched) deliveredEventIds.add(event.eventId);
    } catch (error: any) {
      result.failed++;
      // 404/410 は購読が失効しているので削除（掃除）。他の購読への送信は続行する。
      const status = error?.statusCode;
      if (status === 404 || status === 410) {
        await ddb
          .deleteItem(env.SUBSCRIPTIONS_TABLE, { profileId: sub.profileId, endpointHash: sub.endpointHash })
          .catch(() => undefined);
        result.removedSubscriptions++;
      }
    }
  }

  // 送信できたイベントを通知済みにする。失敗分は未通知のまま次回へ回る。
  for (const event of pending) {
    if (!deliveredEventIds.has(event.eventId)) continue;
    await markNotified(env, ddb, event).catch(() => undefined);
    result.markedEvents++;
  }

  console.log(
    `[notify] ${jst} 送信${result.sent} 失敗${result.failed} 購読削除${result.removedSubscriptions} ` +
      `通知済み${result.markedEvents}/${result.pending} 滞留解消${result.staleSkipped}`
  );
  return result;
}

async function markNotified(env: Env, ddb: DynamoClient, event: EventRecord): Promise<void> {
  await ddb.putItem(env.EVENTS_TABLE, { ...event, notifiedAt: new Date().toISOString() });
}
