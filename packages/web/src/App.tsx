import { ArrowUp, Bell, BellRing, Bookmark, BookmarkCheck, CalendarDays, History, Map as MapIcon, MapPin, Search, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchAreas, hasApiConfig, searchEvents, type EventItem } from "./api";
import { EventDetail } from "./EventDetail";
import { EventsMap } from "./EventsMap";
import { enablePush, isPushSupported, notificationPermission } from "./push";
import { buildPreferences, clearViews, loadViewedEvents, recommend, recordView, viewCount } from "./recommend";

// 愛媛県内20市町
const EHIME_AREAS = [
  "松山市", "今治市", "宇和島市", "八幡浜市", "新居浜市", "西条市", "大洲市", "伊予市", "四国中央市", "西予市", "東温市",
  "上島町", "久万高原町", "松前町", "砥部町", "内子町", "伊方町", "松野町", "鬼北町", "愛南町"
];

const CATEGORIES = ["祭り・伝統", "音楽・ライブ", "スポーツ", "自然・アウトドア", "アート・展示", "グルメ・マルシェ", "ワークショップ", "文化・講演", "デパート・モール", "その他"];

type SortKey = "recent" | "dateAsc" | "dateDesc";
type ViewKey = "all" | "saved" | "history" | "map";
type FontScale = "small" | "medium" | "large";
const PAGE_SIZE = 12;
const AREA_KEY = "events-ai-area";
const BOOKMARK_KEY = "events-ai-bookmarks";
const FONT_KEY = "events-ai-font-scale";

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
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = localStorage.getItem(FONT_KEY);
    return saved === "small" || saved === "large" ? saved : "medium";
  });
  const [showTop, setShowTop] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const [selected, setSelected] = useState<EventItem | null>(null);

  const apiReady = hasApiConfig();

  const areaOptions = useMemo(() => {
    const set = new Set<string>(EHIME_AREAS);
    for (const a of extraAreas) set.add(a);
    return [...set];
  }, [extraAreas]);

  const bookmarkCount = Object.keys(bookmarks).length;
  const viewedEvents = useMemo(() => loadViewedEvents(), [viewTick, view]);
  const historyCount = useMemo(() => viewCount(), [viewTick, view]);
  const filtered = useMemo(() => {
    if (view === "history") {
      // 履歴は閲覧順を維持。カテゴリ絞り込みのみ適用（終了済みも表示する）
      return categories.length > 0
        ? viewedEvents.filter((e) => categories.includes(e.category ?? "その他"))
        : viewedEvents;
    }
    const baseList = view === "saved" ? Object.values(bookmarks) : events;
    return sortAndFilter(baseList, { hidePast, sortBy, categories });
  }, [view, viewedEvents, bookmarks, events, hidePast, sortBy, categories]);
  const visible = filtered.slice(0, visibleCount);
  const newCount = useMemo(() => events.filter(isNew).length, [events]);
  const recommendations = useMemo(() => {
    const prefs = buildPreferences(Object.values(bookmarks));
    const bookmarkedIds = new Set(Object.keys(bookmarks));
    return recommend(events, prefs, bookmarkedIds, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, bookmarks, viewTick]);

  function handleViewDetail(event: EventItem) {
    recordView(event);
    setViewTick((t) => t + 1);
  }

  function openDetail(event: EventItem) {
    setSelected(event);
    handleViewDetail(event);
  }

  useEffect(() => {
    void fetchAreas().then(setExtraAreas).catch(() => undefined);
    void runSearch(localStorage.getItem(AREA_KEY) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, fontScale);
  }, [fontScale]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

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

  function handleClearHistory() {
    if (!window.confirm("閲覧履歴をすべて消去します。よろしいですか？（ブックマークは消えません）")) return;
    clearViews();
    setViewTick((t) => t + 1);
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
    <div className={`enavi fs-${fontScale}`}>
      <header className="enaviHeader">
        <div className="enaviHeaderInner">
          <div className="enaviHeaderText">
            <h1>えひめイベントナビ</h1>
            <p>愛媛県内20市町のイベント情報をまとめてチェック</p>
          </div>
          <div className="fontSizeControl" role="group" aria-label="文字サイズの変更">
            <span aria-hidden="true">文字</span>
            {([["small", "小"], ["medium", "中"], ["large", "大"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={fontScale === value ? "active" : ""}
                onClick={() => setFontScale(value)}
                aria-pressed={fontScale === value}
                aria-label={`文字サイズ${label}`}
                title={`文字サイズ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
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
          <button
            type="button"
            className={view === "history" ? "viewTab active" : "viewTab"}
            onClick={() => switchView("history")}
          >
            <History size={15} /> 閲覧履歴（{historyCount}）
          </button>
          <button
            type="button"
            className={view === "map" ? "viewTab active" : "viewTab"}
            onClick={() => switchView("map")}
          >
            <MapIcon size={15} /> マップ
          </button>
        </div>

        <form className="filterCard" onSubmit={handleSubmit} hidden={view === "saved" || view === "history"}>
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

        {view === "all" && recommendations.length > 0 && (
          <section className="recoSection" aria-label="あなたにおすすめ">
            <h2 className="recoTitle"><Sparkles size={16} /> あなたにおすすめ</h2>
            <p className="recoHint">ブックマークや閲覧したイベントの傾向から選びました。</p>
            <div className="recoStrip">
              {recommendations.map((event) => {
                const saved = Boolean(bookmarks[event.eventId]);
                return (
                  <article className="recoCard clickable" key={event.eventId} onClick={() => openDetail(event)}>
                    <div className="recoCardHead">
                      {event.category && <span className="recoCat">{event.category}</span>}
                      <button
                        type="button"
                        className={saved ? "recoBookmark saved" : "recoBookmark"}
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(event); }}
                        aria-label={saved ? "ブックマークを外す" : "ブックマークに追加"}
                        title={saved ? "ブックマークを外す" : "ブックマークに追加"}
                      >
                        {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                      </button>
                    </div>
                    <h3>{event.title}</h3>
                    <div className="recoMeta">
                      <span><MapPin size={12} />{event.area || "地域不明"}</span>
                      <span><CalendarDays size={12} />{formatEventDate(event)}</span>
                    </div>
                    <a href={event.url} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); handleViewDetail(event); }}>元ページ →</a>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {view === "map" && (
          <>
            <label className="checkboxLabel listCheckbox">
              <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
              <span>終了したイベントを隠す</span>
            </label>
            <EventsMap events={filtered} />
            <p className="mapNote">ピンは各イベントの「開催地（市町）」のおおよその位置です（会場ピンポイントではありません）。上の地域・カテゴリで絞り込めます。</p>
          </>
        )}

        {view !== "map" && (
        <>
        <div className="listHeader">
          <div>
            <p className="newBadge"><Sparkles size={14} /> 新着イベント {newCount}</p>
            <p className="listStatus">
              {view === "saved" ? "ブックマーク一覧" : view === "history" ? "閲覧履歴（新しい順）" : status}・{filtered.length}件
            </p>
          </div>
          {view === "history" ? (
            historyCount > 0 && (
              <button className="ghostButton" type="button" onClick={handleClearHistory}>
                <Trash2 size={16} /> 履歴を消去
              </button>
            )
          ) : (
            <label className="sortLabel">
              <span>並び替え</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                <option value="dateAsc">開催日が近い順</option>
                <option value="dateDesc">開催日が遠い順</option>
                <option value="recent">新着順</option>
              </select>
            </label>
          )}
        </div>

        {view !== "history" && (
          <label className="checkboxLabel listCheckbox">
            <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
            <span>終了したイベントを隠す</span>
          </label>
        )}

        <div className="cardGrid">
          {visible.map((event) => {
            const saved = Boolean(bookmarks[event.eventId]);
            return (
            <article className="enaviCard clickable" key={event.eventId} onClick={() => openDetail(event)}>
              <div className="cardThumb">
                {event.imageUrl
                  ? <img src={event.imageUrl} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <div className="thumbPlaceholder"><CalendarDays size={28} /></div>}
                {event.category && <span className="catBadge">{event.category}</span>}
                {isNew(event) && <span className="newTag">NEW</span>}
                <button
                  type="button"
                  className={saved ? "bookmarkButton saved" : "bookmarkButton"}
                  onClick={(e) => { e.stopPropagation(); toggleBookmark(event); }}
                  aria-label={saved ? "ブックマークを外す" : "ブックマークに追加"}
                  title={saved ? "ブックマークを外す" : "ブックマークに追加"}
                >
                  {saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                </button>
              </div>
              <div className="cardBody">
                <div className="cardMeta">
                  <span><MapPin size={13} />{event.venue || event.area || "地域不明"}</span>
                  <span><CalendarDays size={13} />{formatEventDate(event)}</span>
                </div>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <div className="cardFooter">
                  <span>{event.sourceName}</span>
                  <a href={event.url} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); handleViewDetail(event); }}>元ページ →</a>
                </div>
              </div>
            </article>
            );
          })}
          {visible.length === 0 && (
            <div className="emptyState">
              {view === "saved" ? <Bookmark size={34} /> : view === "history" ? <History size={34} /> : <Search size={34} />}
              <p>
                {view === "saved"
                  ? "まだブックマークがありません。気になるイベントの🔖を押すとここに保存されます。"
                  : view === "history"
                    ? "まだ閲覧履歴がありません。イベントの「詳細 →」を開くとここに残ります。"
                    : "該当するイベントがありません。"}
              </p>
            </div>
          )}
        </div>

        {visibleCount < filtered.length && (
          <button className="moreButton" type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            もっと見る（残り{filtered.length - visibleCount}件）
          </button>
        )}
        </>
        )}
      </main>

      <footer className="enaviFooter">
        © 2026 えひめイベントナビ ｜ 地域イベント情報をAIが自動収集・要約
      </footer>

      {showTop && (
        <button className="scrollTopBtn" type="button" onClick={scrollToTop} aria-label="ページの先頭へ戻る" title="上へ戻る">
          <ArrowUp size={22} />
        </button>
      )}

      {selected && (
        <EventDetail
          event={selected}
          saved={Boolean(bookmarks[selected.eventId])}
          onClose={() => setSelected(null)}
          onToggleBookmark={toggleBookmark}
        />
      )}
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
