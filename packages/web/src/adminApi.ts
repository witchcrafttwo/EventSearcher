const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export type Source = {
  id: string;
  name: string;
  url: string;
  area: string;
  type: "html" | "rss";
  enabled?: boolean;
  forceCategory?: string;
};

const TOKEN_KEY = "events-ai-admin-token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function prefix(): string {
  return apiBaseUrl ? apiBaseUrl.replace(/\/$/, "") : "";
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${prefix()}${path}`, { ...init, headers });
  if (response.status === 401) throw new Error("認証に失敗しました。トークンを確認してください。");
  return response;
}

export async function listSources(): Promise<Source[]> {
  const response = await adminFetch("/admin/sources-all");
  if (!response.ok) throw new Error("情報源を取得できませんでした");
  const body = (await response.json()) as { sources: Source[] };
  return body.sources;
}

export type Stats = { total: number; counts: Record<string, number>; unmatched: number };

export async function getStats(): Promise<Stats> {
  const response = await adminFetch("/admin/stats");
  if (!response.ok) throw new Error("統計を取得できませんでした");
  return (await response.json()) as Stats;
}

export async function addSource(input: { url: string; name?: string; area?: string }): Promise<Source> {
  const response = await adminFetch("/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "追加できませんでした");
  }
  return ((await response.json()) as { source: Source }).source;
}

export async function deleteSource(id: string): Promise<void> {
  const response = await adminFetch(`/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("削除できませんでした");
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const response = await adminFetch(`/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error("ON/OFFの更新に失敗しました");
}

export async function setSourceCategory(id: string, forceCategory: string): Promise<void> {
  const response = await adminFetch(`/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ forceCategory })
  });
  if (!response.ok) throw new Error("カテゴリ設定の更新に失敗しました");
}

export async function runIngest(sourceId?: string): Promise<{ saved: number; notified: number; candidates: number }> {
  const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
  const response = await adminFetch(`/admin/ingest${query}`, { method: "POST" });
  if (!response.ok) throw new Error("収集に失敗しました");
  return (await response.json()) as { saved: number; notified: number; candidates: number };
}

export async function clearEvents(sourceId?: string): Promise<{ deleted: number }> {
  const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
  const response = await adminFetch(`/admin/clear-events${query}`, { method: "POST" });
  if (!response.ok) throw new Error("削除に失敗しました");
  return (await response.json()) as { deleted: number };
}
