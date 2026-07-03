import { Bell, BellRing, Bookmark, BookmarkCheck, CalendarDays, MapPin, Search, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchAreas, hasApiConfig, searchEvents, type EventItem } from "./api";
import { enablePush, isPushSupported, notificationPermission } from "./push";

// 愛媛県内20市町
const EHIME_AREAS = [
  "松山市", "今治市", "宇和島市", "八幡浜市", "新居浜市", "西条市", "大洲市", "伊予市", "四国中央市", "西予市", "東温市",
  "上島町", "久万高原町", "松前町", "砥部町", "内子町", "伊方町", "松野町", "鬼北町", "愛南町"
];

const CATEGORIES = ["祭り・伝統", "音楽・ライブ", "スポーツ", "自然・アウトドア", "アート・展示", "グルメ・マルシェ", "ワークショップ", "文化・講演", "デパート・モール", "その他"];

type SortKey = "recent" | "dateAsc" | "dateDesc";
type ViewKey = "all" | "saved";
const PAGE_SIZE = 12;
const AREA_KEY = "events-ai-area";
const BOOKMARK_KEY = "events-ai-bookmarks";

function loadBookmarks(): Record<string, EventItem> {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, EventItem>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function App() {
  const [area, setArea] = useState(() => localStorage.getItem(AREA_KEY) ?? "");
  const [categories, setCategories] = useState<string[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState("地域やカテゴリを選んで検索できます。");
  const [isBusy, setIsBusy] = useState(false);
  const [extraAreas, setExtraAreas] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("dateAsc");
  const [hidePast, setHidePast] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [view, setView] = useState<ViewKey>("all");
  const [bookmarks, setBookmarks] = useState<Record<string, EventItem>>(() => loadBookmarks());
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");
  const [notifyOn, setNotifyOn] = useState(() => notificationPermission() === "granted");

  const apiReady = hasApiConfig();

  const areaOptions = useMemo(() => {
    const set = new Set<string>(EHIME_AREAS);
    for (const a of extraAreas) set.add(a);
    return [...set];
  }, [extraAreas]);

  const bookmarkCount = Object.keys(bookmarks).length;
  const baseList = view === "saved" ? Object.values(bookmarks) : events;
  const filtered = useMemo(
    () => sortAndFilter(baseList, { hidePast, sortBy, categories }),
    [baseList, hidePast, sortBy, categories]
  );
  const visible = filtered.slice(0, visibleCount);
  const newCount = useMemo(() => events.filter(isNew).length, [events]);

  useEffect(() => {
    void fetchAreas().then(setExtraAreas).catch(() => undefined);
    void runSearch(localStorage.getItem(AREA_KEY) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
  }, [bookmarks]);

  function toggleBookmark(event: EventItem) {
    setBookmarks((prev) => {
      const next = { ...prev };
      if (next[event.eventId]) delete next[event.eventId];
      else next[event.eventId] = event;
      return next;
    });
  }

  function switchView(next: ViewKey) {
    setView(next);
    setVisibleCount(PAGE_SIZE);
  }

  function toggleCategory(cat: string) {
    setVisibleCount(PAGE_SIZE);
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  async function handleEnableNotify() {
    setNotifyBusy(true);
    setNotifyMsg("通知を設定しています…");
    try {
      const msg = await enablePush(area, categories);
      setNotifyMsg(msg);
      setNotifyOn(notificationPermission() === "granted");
    } catch (error) {
      setNotifyMsg(error instanceof Error ? error.message : "通知の設定に失敗しました。");
    } finally {
      setNotifyBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    localStorage.setItem(AREA_KEY, area);
    setVisibleCount(PAGE_SIZE);
    await runSearch(area);
  }

  function handleReset() {
    setArea("");
    setCategories([]);
    setSortBy("dateAsc");
    setVisibleCount(PAGE_SIZE);
    localStorage.removeItem(AREA_KEY);
    void runSearch("");
  }

  async function runSearch(target: string) {
    setIsBusy(true);
    setStatus("検索中です。");
    try {
      setEvents(await searchEvents(target));
      setStatus(target ? `「${target}」のイベント` : "すべての地域のイベント");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "検索に失敗しました。");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="enavi">
      <header className="enaviHeader">
        <div className="enaviHeaderInner">
          <h1>えひめイベントナビ</h1>
          <p>愛媛県内20市町のイベント情報をまとめてチェック</p>
        </div>
      </header>

      <main className="enaviMain">
        {!apiReady && <div className="notice">API未接続です。</div>}

        <div className="viewTabs">
          <button
            type="button"
            className={view === "all" ? "viewTab active" : "viewTab"}
            onClick={() => switchView("all")}
          >
            <Search size={15} /> すべてのイベント
          </button>
          <button
            type="button"
            className={view === "saved" ? "viewTab active" : "viewTab"}
            onClick={() => switchView("saved")}
          >
            <BookmarkCheck size={15} /> ブックマーク（{bookmarkCount}）
          </button>
        </div>

        <form className="filterCard" onSubmit={handleSubmit} hidden={view === "saved"}>
          <div className="filterRow">
            <label className="field">
              <span><MapPin size={14} /> 地域</span>
              <select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">すべての市町</option>
                {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </div>
          <div className="field">
            <span>カテゴリ（複数選択できます）</span>
            <div className="categoryChips">
              {CATEGORIES.map((c) => (
                <label key={c} className={categories.includes(c) ? "categoryChip active" : "categoryChip"}>
                  <input
                    type="checkbox"
                    checked={categories.includes(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="filterActions">
            <button className="primaryButton" type="submit" disabled={isBusy}>
              <Search size={16} /> 検索
            </button>
            <button className="ghostButton" type="button" onClick={handleReset} disabled={isBusy}>リセット</button>
            {isPushSupported() && (
              <button
                className="ghostButton"
                type="button"
                onClick={() => void handleEnableNotify()}
                disabled={notifyBusy}
                title="今の地域・カテゴリ条件で新着イベントを通知します"
              >
                {notifyOn ? <BellRing size={16} /> : <Bell size={16} />}
                {notifyOn ? "通知を更新" : "新着を通知で受け取る"}
              </button>
            )}
          </div>
          {notifyMsg && <p className="notifyStatus">{notifyMsg}</p>}
        </form>

        <div className="listHeader">
          <div>
            <p className="newBadge"><Sparkles size={14} /> 新着イベント {newCount}</p>
            <p className="listStatus">{view === "saved" ? "ブックマーク一覧" : status}・{filtered.length}件</p>
          </div>
          <label className="sortLabel">
            <span>並び替え</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              <option value="dateAsc">開催日が近い順</option>
              <option value="dateDesc">開催日が遠い順</option>
              <option value="recent">新着順</option>
            </select>
          </label>
        </div>

        <label className="checkboxLabel listCheckbox">
          <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
          <span>終了したイベントを隠す</span>
        </label>

        <div className="cardGrid">
          {visible.map((event) => {
            const saved = Boolean(bookmarks[event.eventId]);
            return (
            <article className="enaviCard" key={event.eventId}>
              <div className="cardThumb">
                {event.imageUrl
                  ? <img src={event.imageUrl} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <div className="thumbPlaceholder"><CalendarDays size={28} /></div>}
                {event.category && <span className="catBadge">{event.category}</span>}
                {isNew(event) && <span className="newTag">NEW</span>}
                <button
                  type="button"
                  className={saved ? "bookmarkButton saved" : "bookmarkButton"}
                  onClick={() => toggleBookmark(event)}
                  aria-label={saved ? "ブックマークを外す" : "ブックマークに追加"}
                  title={saved ? "ブックマークを外す" : "ブックマークに追加"}
                >
                  {saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                </button>
              </div>
              <div className="cardBody">
                <div className="cardMeta">
                  <span><MapPin size={13} />{event.area || "地域不明"}</span>
                  <span><CalendarDays size={13} />{formatEventDate(event)}</span>
                </div>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <div className="cardFooter">
                  <span>{event.sourceName}</span>
                  <a href={event.url} target="_blank" rel="noreferrer">詳細 →</a>
                </div>
              </div>
            </article>
            );
          })}
          {visible.length === 0 && (
            <div className="emptyState">
              {view === "saved" ? <Bookmark size={34} /> : <Search size={34} />}
              <p>{view === "saved" ? "まだブックマークがありません。気になるイベントの🔖を押すとここに保存されます。" : "該当するイベントがありません。"}</p>
            </div>
          )}
        </div>

        {visibleCount < filtered.length && (
          <button className="moreButton" type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            もっと見る（残り{filtered.length - visibleCount}件）
          </button>
        )}
      </main>

      <footer className="enaviFooter">
        © 2026 えひめイベントナビ ｜ 地域イベント情報をAIが自動収集・要約
      </footer>
    </div>
  );
}

function sortAndFilter(events: EventItem[], opts: { hidePast: boolean; sortBy: SortKey; categories: string[] }): EventItem[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let list = events;
  if (opts.categories.length > 0) list = list.filter((e) => opts.categories.includes(e.category ?? "その他"));
  if (opts.hidePast) {
    list = list.filter((e) => {
      const end = e.eventEndDate ?? e.eventDate;
      if (!end) return true;
      const d = new Date(end);
      return Number.isNaN(d.getTime()) || d >= startOfToday;
    });
  }

  return [...list].sort((a, b) => {
    if (opts.sortBy === "recent") return dateValue(b.publishedAt, 0) - dateValue(a.publishedAt, 0);
    if (opts.sortBy === "dateDesc") return dateValue(b.eventDate, 0) - dateValue(a.eventDate, 0);
    return dateValue(a.eventDate, Infinity) - dateValue(b.eventDate, Infinity); // dateAsc
  });
}

function dateValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? fallback : t;
}

function isNew(event: EventItem): boolean {
  // 収集日時(createdAt)基準。無ければpublishedAtで代用。7日以内ならNEW。
  const base = event.createdAt ?? event.publishedAt;
  const t = new Date(base).getTime();
  return !Number.isNaN(t) && Date.now() - t < 7 * 24 * 60 * 60 * 1000;
}

function formatEventDate(event: EventItem): string {
  if (!event.eventDate) return "日程調整中";
  const start = formatMaybe(event.eventDate);
  if (event.eventEndDate && event.eventEndDate !== event.eventDate) return `${start}〜${formatMaybe(event.eventEndDate)}`;
  return start;
}

function formatMaybe(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(d);
}
