import { Link2, LogIn, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { addSource, clearEvents, deleteSource, getToken, listSources, runIngest, setSourceEnabled, setToken, type Source } from "./adminApi";

export function Admin() {
  const [token, setTokenState] = useState(getToken());
  const [authed, setAuthed] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newArea, setNewArea] = useState("");
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (getToken()) void tryLoad();
  }, []);

  async function tryLoad() {
    await run("読み込みました。", async () => {
      setSources(await listSources());
      setAuthed(true);
    });
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToken(token.trim());
    await tryLoad();
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newUrl.trim()) return;
    await run("情報源を追加しました。", async () => {
      const created = await addSource({ url: newUrl.trim(), area: newArea.trim() || undefined });
      setSources((current) => [...current.filter((s) => s.id !== created.id), created]);
      setNewUrl("");
      setNewArea("");
    });
  }

  async function handleDelete(id: string) {
    await run("削除しました。", async () => {
      await deleteSource(id);
      setSources((current) => current.filter((s) => s.id !== id));
    });
  }

  async function handleToggle(source: Source) {
    const next = source.enabled === false;
    // 楽観的に更新
    setSources((current) => current.map((s) => (s.id === source.id ? { ...s, enabled: next } : s)));
    try {
      await setSourceEnabled(source.id, next);
      setStatus(`「${source.name}」を${next ? "表示" : "非表示"}にしました。`);
    } catch (error) {
      // 失敗したら戻す
      setSources((current) => current.map((s) => (s.id === source.id ? { ...s, enabled: !next } : s)));
      setStatus(error instanceof Error ? error.message : "更新に失敗しました。");
    }
  }

  async function handleClear() {
    if (!window.confirm("保存済みのイベントを全て削除します。よろしいですか？（登録サイトは消えません）")) return;
    await run("全イベントを削除しました。収集し直してください。", async () => {
      const result = await clearEvents();
      setStatus(`${result.deleted}件のイベントを削除しました。`);
    });
  }

  async function handleIngest() {
    setIsBusy(true);
    setStatus("収集を開始します…");
    try {
      let totalSaved = 0;
      const targets = sources; // 収集は全ソース（表示ON/OFFは検索側で制御）
      for (let i = 0; i < targets.length; i++) {
        const source = targets[i];
        setStatus(`収集中 (${i + 1}/${targets.length}): ${source.name} …`);
        try {
          const result = await runIngest(source.id);
          totalSaved += result.saved;
        } catch (error) {
          setStatus(`「${source.name}」の収集でエラー: ${error instanceof Error ? error.message : "失敗"}（続行します）`);
        }
      }
      setStatus(`収集完了: 合計 ${totalSaved}件を新規/更新しました。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "処理に失敗しました。");
    } finally {
      setIsBusy(false);
    }
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

  if (!authed) {
    return (
      <main className="appShell">
        <section className="workspace">
          <div className="toolbar">
            <div>
              <p className="eyebrow">管理者</p>
              <h1>管理者ログイン</h1>
            </div>
          </div>
          <form className="sourcePanel" onSubmit={handleLogin}>
            <p className="hint">管理者トークンを入力してください。</p>
            <div className="sourceForm">
              <input
                type="password"
                value={token}
                placeholder="ADMIN_TOKEN"
                onChange={(event) => setTokenState(event.target.value)}
              />
              <button className="primaryButton" type="submit" disabled={isBusy}>
                <LogIn size={18} />
                ログイン
              </button>
            </div>
            {status && <p className="status">{status}</p>}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">管理者</p>
            <h1>情報源の管理</h1>
          </div>
          <button className="iconButton" type="button" title="再読み込み" onClick={() => void tryLoad()} disabled={isBusy}>
            <RefreshCw size={20} />
          </button>
        </div>

        <section className="sourcePanel">
          <div className="panelHeader split">
            <div className="panelHeaderTitle">
              <Link2 size={20} />
              <h2>情報源URL</h2>
            </div>
            <button className="primaryButton" type="button" onClick={() => void handleIngest()} disabled={isBusy || sources.length === 0}>
              <Sparkles size={18} />
              今すぐ収集
            </button>
          </div>
          <p className="hint">イベント情報のあるページやRSSのURLを登録すると、AIが各イベントの内容から開催地(市区町村)を自動判別して要約します。エリアは通常入力不要です。 チェックを外すと、そのサイトのイベントは検索結果に表示されません（データは残ります）。</p>
          <div className="dangerRow">
            <button className="dangerButton" type="button" onClick={() => void handleClear()} disabled={isBusy}>
              <Trash2 size={16} />
              全イベント削除（古いデータの一掃）
            </button>
          </div>

          <form className="sourceForm" onSubmit={handleAdd}>
            <input type="url" value={newUrl} placeholder="https://example.jp/events" onChange={(e) => setNewUrl(e.target.value)} required />
            <input value={newArea} placeholder="エリア（任意・自動判別できない時の予備）" onChange={(e) => setNewArea(e.target.value)} />
            <button className="secondaryButton" type="submit" disabled={isBusy}>
              <Plus size={18} />
              追加
            </button>
          </form>

          <ul className="sourceList">
            {sources.map((source) => (
              <li key={source.id} className={source.enabled === false ? "sourceDisabled" : ""}>
                <label className="sourceToggle" title={source.enabled === false ? "非表示（検索結果に出さない）" : "表示（検索結果に出す）"}>
                  <input
                    type="checkbox"
                    checked={source.enabled !== false}
                    onChange={() => void handleToggle(source)}
                    disabled={isBusy}
                  />
                </label>
                <div className="sourceInfo">
                  <span className="sourceName">{source.name}</span>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                  <span className="sourceTag">{source.area || "エリア自動判定"} / {source.type.toUpperCase()}</span>
                </div>
                <button className="iconButton" type="button" title="削除" onClick={() => void handleDelete(source.id)} disabled={isBusy}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
            {sources.length === 0 && <li className="sourceEmpty">まだ情報源がありません。URLを追加してください。</li>}
          </ul>

          {status && <p className="status">{status}</p>}
        </section>
      </section>
    </main>
  );
}
