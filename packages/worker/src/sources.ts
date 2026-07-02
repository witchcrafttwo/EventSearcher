import { sha256Hex } from "./crypto.js";
import { DynamoClient } from "./dynamo.js";
import { defaultSources, type DefaultSource } from "./default-sources.js";
import type { Env, EventSourceConfig } from "./types.js";

type FileSource = DefaultSource;

/** DynamoDBに保存された情報源URLの管理 */

export async function listSources(env: Env): Promise<EventSourceConfig[]> {
  const ddb = new DynamoClient(env);
  return ddb.scanAll<EventSourceConfig>(env.SOURCES_TABLE);
}

export async function addSource(
  env: Env,
  input: { url?: string; name?: string; area?: string; type?: string }
): Promise<EventSourceConfig> {
  const url = String(input.url ?? "").trim();
  if (!isValidUrl(url)) throw new Error("有効なURL(https://...)を入力してください");

  const source: EventSourceConfig = {
    id: (await sha256Hex(url)).slice(0, 16),
    name: String(input.name ?? "").trim() || hostnameOf(url),
    url,
    area: String(input.area ?? "").trim(),
    type: normalizeType(input.type, url),
    enabled: true
  };

  const ddb = new DynamoClient(env);
  await ddb.putItem(env.SOURCES_TABLE, source);
  return source;
}

/** ソースのON/OFFを更新 */
export async function setSourceEnabled(env: Env, id: string, enabled: boolean): Promise<EventSourceConfig> {
  return updateSource(env, id, { enabled });
}

/** ソースの属性(ON/OFF・固定カテゴリ)を更新 */
export async function updateSource(
  env: Env,
  id: string,
  patch: { enabled?: boolean; forceCategory?: string }
): Promise<EventSourceConfig> {
  if (!id) throw new Error("id is required");
  const ddb = new DynamoClient(env);
  const existing = await ddb.getItem<EventSourceConfig>(env.SOURCES_TABLE, { id });
  if (!existing) throw new Error("source not found");
  const updated: EventSourceConfig = { ...existing };
  if (patch.enabled !== undefined) updated.enabled = patch.enabled;
  if (patch.forceCategory !== undefined) {
    const value = patch.forceCategory.trim();
    if (value) updated.forceCategory = value;
    else delete updated.forceCategory; // 空文字ならクリア（AI自動判定に戻す）
  }
  await ddb.putItem(env.SOURCES_TABLE, updated);
  return updated;
}

export async function deleteSource(env: Env, id: string): Promise<{ ok: true }> {
  if (!id) throw new Error("id is required");
  const ddb = new DynamoClient(env);
  await ddb.deleteItem(env.SOURCES_TABLE, { id });
  return { ok: true };
}

/** ingestが使う最終的な情報源: 設定ファイル + DB保存分 + 環境変数(EVENT_SOURCES_JSON)をマージ */
export async function loadAllSources(env: Env): Promise<EventSourceConfig[]> {
  const fromFile = await normalizeFileSources(defaultSources as FileSource[]);
  const dbSources = await listSources(env).catch(() => [] as EventSourceConfig[]);
  const envSources = parseEnvSources(env.EVENT_SOURCES_JSON ?? "[]");

  // ベースはファイル/環境変数、DBの状態(トグル等)を上書き優先。名前はファイル優先で保持。
  const byId = new Map<string, EventSourceConfig>();
  for (const source of [...envSources, ...fromFile]) {
    if (source.id && source.url && source.type) {
      byId.set(source.id, { ...source, enabled: source.enabled !== false });
    }
  }
  for (const source of dbSources) {
    if (!source.id || !source.url || !source.type) continue;
    const existing = byId.get(source.id);
    byId.set(source.id, {
      ...(existing ?? {}),
      ...source,
      name: existing?.name || source.name,
      enabled: source.enabled !== false
    });
  }
  return [...byId.values()];
}

/** 設定ファイルの各エントリを EventSourceConfig に整える（id/type/nameを補完） */
async function normalizeFileSources(entries: FileSource[]): Promise<EventSourceConfig[]> {
  const result: EventSourceConfig[] = [];
  for (const entry of entries) {
    const url = String(entry.url ?? "").trim();
    if (!isValidUrl(url)) continue;
    result.push({
      id: entry.id || (await sha256Hex(url)).slice(0, 16),
      name: entry.name?.trim() || hostnameOf(url),
      url,
      area: entry.area?.trim() || "",
      type: normalizeType(entry.type, url),
      enabled: entry.enabled !== false
    });
  }
  return result;
}

function parseEnvSources(value: string): EventSourceConfig[] {
  try {
    const parsed = JSON.parse(value) as EventSourceConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeType(type: string | undefined, url: string): "html" | "rss" {
  const value = (type ?? "").toLowerCase();
  if (value === "rss" || value === "html") return value;
  return /\.(xml|rss)(\?|$)|\/(feed|rss)\b/i.test(url) ? "rss" : "html";
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
