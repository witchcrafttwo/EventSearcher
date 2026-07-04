import type { EventItem } from "./api";

// 閲覧履歴・ブックマークから「好み」を推定し、おすすめイベントを算出する（すべてローカル）。
const VIEW_KEY = "events-ai-views";
const MAX_VIEWS = 120;

type ViewRecord = { eventId: string; category?: string; area?: string; ts: number };

function loadViews(): ViewRecord[] {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ViewRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** イベントを閲覧したことを記録（詳細クリック時などに呼ぶ）。同一は最新へ寄せ、最大件数で打ち切り。 */
export function recordView(event: Pick<EventItem, "eventId" | "category" | "area">): void {
  const list = loadViews().filter((v) => v.eventId !== event.eventId);
  list.unshift({ eventId: event.eventId, category: event.category, area: event.area, ts: Date.now() });
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(list.slice(0, MAX_VIEWS)));
  } catch {
    /* 保存失敗は無視 */
  }
}

type Preferences = {
  category: Record<string, number>;
  area: Record<string, number>;
  hasSignal: boolean;
};

/** ブックマーク(強い好み)＋閲覧履歴(弱い好み)から、カテゴリ・エリアの重みを作る。 */
export function buildPreferences(bookmarks: EventItem[]): Preferences {
  const category: Record<string, number> = {};
  const area: Record<string, number> = {};
  const add = (map: Record<string, number>, key: string | undefined, weight: number) => {
    const k = (key ?? "").trim();
    if (k) map[k] = (map[k] ?? 0) + weight;
  };

  // ブックマーク: 強い好み
  for (const b of bookmarks) {
    add(category, b.category, 3);
    add(area, b.area, 2);
  }
  // 閲覧履歴: 弱い好み
  for (const v of loadViews()) {
    add(category, v.category, 1);
    add(area, v.area, 0.5);
  }

  const hasSignal = Object.keys(category).length > 0 || Object.keys(area).length > 0;
  return { category, area, hasSignal };
}

/**
 * おすすめイベントを算出。
 * - 好みのカテゴリ/エリアに一致するほど高スコア
 * - 既にブックマーク済みは除外（発見性のため）
 * - 終了済み（開催日が過去）は除外。日付不明は残す
 * - スコア0以下は出さない
 */
export function recommend(
  events: EventItem[],
  preferences: Preferences,
  bookmarkedIds: Set<string>,
  limit = 8
): EventItem[] {
  if (!preferences.hasSignal) return [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const scored = events
    .filter((e) => !bookmarkedIds.has(e.eventId))
    .filter((e) => {
      const end = e.eventEndDate ?? e.eventDate;
      if (!end) return true;
      const d = new Date(end);
      return Number.isNaN(d.getTime()) || d >= startOfToday;
    })
    .map((e) => {
      const catScore = preferences.category[(e.category ?? "").trim()] ?? 0;
      const areaScore = preferences.area[(e.area ?? "").trim()] ?? 0;
      return { event: e, score: catScore + areaScore * 0.5 };
    })
    .filter((x) => x.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 同点は開催日が近い順
    const da = a.event.eventDate ? new Date(a.event.eventDate).getTime() : Infinity;
    const db = b.event.eventDate ? new Date(b.event.eventDate).getTime() : Infinity;
    return da - db;
  });

  return scored.slice(0, limit).map((x) => x.event);
}
