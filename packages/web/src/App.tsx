import { Bell, CalendarDays, MapPin, RefreshCw, Save, Search, Smartphone } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchEvents, hasApiConfig, saveProfile, savePushSubscription, type EventItem, type Profile } from "./api";
import { subscribePushNotifications } from "./pwa";

const interestOptions = ["自然", "科学", "工作", "音楽", "スポーツ", "読書", "アート", "食育", "乗り物"];
const defaultProfile: Profile = {
  childAge: 6,
  interests: ["自然", "工作"],
  area: "県内",
  notificationLeadDays: 45
};

export function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState("プロフィールを保存すると、条件に合うイベントを確認できます。");
  const [isBusy, setIsBusy] = useState(false);

  const profileId = profile.profileId;
  const apiReady = hasApiConfig();
  const matchedCount = useMemo(() => events.length, [events]);

  useEffect(() => {
    if (profileId && apiReady) void reloadEvents(profileId);
  }, [profileId, apiReady]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("プロフィールを保存しました。", async () => {
      const saved = await saveProfile(profile);
      setProfile(saved);
      localStorage.setItem("events-ai-profile", JSON.stringify(saved));
      await reloadEvents(saved.profileId);
    });
  }

  async function handlePushRegistration() {
    if (!profileId) {
      setStatus("先にプロフィールを保存してください。");
      return;
    }
    await run("スマホ通知を登録しました。", async () => {
      const subscription = await subscribePushNotifications();
      await savePushSubscription(profileId, subscription);
    });
  }

  async function reloadEvents(id = profileId) {
    if (!id) return;
    await run("イベント一覧を更新しました。", async () => {
      setEvents(await fetchEvents(id));
    });
  }

  async function run(doneMessage: string, task: () => Promise<void>) {
    setIsBusy(true);
    setStatus("処理中です。");
    try {
      await task();
      setStatus(doneMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "処理に失敗しました。");
    } finally {
      setIsBusy(false);
    }
  }

  function toggleInterest(interest: string) {
    setProfile((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest]
    }));
  }

  return (
    <main className="appShell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">県内イベントAI通知</p>
            <h1>条件に合う子ども向けイベント</h1>
          </div>
          <button className="iconButton" type="button" title="イベント再取得" onClick={() => void reloadEvents()} disabled={!profileId || isBusy}>
            <RefreshCw size={20} />
          </button>
        </div>

        {!apiReady && (
          <div className="notice">
            <Search size={18} />
            <span>API未接続です。デプロイ後に VITE_API_BASE_URL を設定してください。</span>
          </div>
        )}

        <div className="layout">
          <form className="profilePanel" onSubmit={handleSubmit}>
            <div className="panelHeader">
              <Smartphone size={20} />
              <h2>通知条件</h2>
            </div>

            <label>
              <span>子の年齢</span>
              <input
                type="number"
                min="0"
                max="18"
                value={profile.childAge}
                onChange={(event) => setProfile({ ...profile, childAge: Number(event.target.value) })}
              />
            </label>

            <label>
              <span>居住エリア</span>
              <input
                value={profile.area}
                placeholder="例: 県央、市北部、〇〇市"
                onChange={(event) => setProfile({ ...profile, area: event.target.value })}
              />
            </label>

            <fieldset>
              <legend>興味</legend>
              <div className="chips">
                {interestOptions.map((interest) => (
                  <button
                    className={profile.interests.includes(interest) ? "chip selected" : "chip"}
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </fieldset>

            <label>
              <span>何日先まで通知するか</span>
              <input
                type="number"
                min="1"
                max="180"
                value={profile.notificationLeadDays}
                onChange={(event) => setProfile({ ...profile, notificationLeadDays: Number(event.target.value) })}
              />
            </label>

            <div className="actions">
              <button className="primaryButton" type="submit" disabled={isBusy || !apiReady}>
                <Save size={18} />
                保存
              </button>
              <button className="secondaryButton" type="button" onClick={() => void handlePushRegistration()} disabled={isBusy || !apiReady}>
                <Bell size={18} />
                通知
              </button>
            </div>
          </form>

          <section className="eventsPanel" aria-live="polite">
            <div className="panelHeader split">
              <div>
                <p className="eyebrow">最新候補</p>
                <h2>{matchedCount}件</h2>
              </div>
              <p className="status">{status}</p>
            </div>

            <div className="eventList">
              {events.map((event) => (
                <article className="eventCard" key={event.eventId}>
                  <div className="eventMeta">
                    <span><MapPin size={15} />{event.area}</span>
                    <span><CalendarDays size={15} />{event.eventDate ?? formatDate(event.publishedAt)}</span>
                  </div>
                  <h3>{event.title}</h3>
                  <p>{event.summary}</p>
                  <div className="eventFooter">
                    <span>{event.sourceName}</span>
                    <a href={event.url} target="_blank" rel="noreferrer">詳細</a>
                  </div>
                </article>
              ))}
              {events.length === 0 && (
                <div className="emptyState">
                  <Search size={34} />
                  <p>まだ条件に合うイベントがありません。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function loadProfile(): Profile {
  const fromUrl = new URLSearchParams(window.location.search).get("profileId");
  const saved = localStorage.getItem("events-ai-profile");
  if (!saved) return fromUrl ? { ...defaultProfile, profileId: fromUrl } : defaultProfile;
  try {
    const profile = JSON.parse(saved) as Profile;
    return fromUrl ? { ...profile, profileId: fromUrl } : profile;
  } catch {
    return defaultProfile;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(value));
}
