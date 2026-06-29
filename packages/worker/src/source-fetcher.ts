import { XMLParser } from "fast-xml-parser";
import type { EventSourceConfig, RawEventCandidate } from "./types.js";

const EVENT_WORDS = ["イベント", "講座", "体験", "ワークショップ", "展示", "まつり", "親子", "子ども", "こども"];

export async function fetchCandidates(sources: EventSourceConfig[]): Promise<RawEventCandidate[]> {
  const batches = await Promise.allSettled(sources.map((source) => fetchSource(source)));
  return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function fetchSource(source: EventSourceConfig): Promise<RawEventCandidate[]> {
  const response = await fetch(source.url, {
    headers: { "user-agent": "prefecture-events-ai/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.url}: ${response.status}`);
  }

  const body = await response.text();
  return source.type === "rss" ? parseRss(source, body) : parseHtml(source, body);
}

function parseRss(source: EventSourceConfig, xml: string): RawEventCandidate[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const items = normalizeArray(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? []);

  return items
    .slice(0, 30)
    .map((item: Record<string, unknown>) => {
      const title = asText(item.title);
      const linkObject = item.link && typeof item.link === "object" ? (item.link as Record<string, unknown>) : undefined;
      const link = asText(linkObject?.["@_href"] ?? item.link);
      const snippet = asText(item.description ?? item.summary ?? item.content);
      const publishedAt = asText(item.pubDate ?? item.published ?? item.updated) || new Date().toISOString();

      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        title,
        url: absolutizeUrl(link, source.url),
        area: source.area,
        snippet: stripTags(snippet).slice(0, 900),
        publishedAt: normalizeDate(publishedAt)
      };
    })
    .filter((candidate) => candidate.title && candidate.url);
}

/**
 * Workers では cheerio が重く不安定なため、正規表現ベースで <a> を抽出する。
 * snippet は本文プレーンテキストからタイトル周辺の文字列を切り出して補う。
 */
function parseHtml(source: EventSourceConfig, html: string): RawEventCandidate[] {
  const plainText = stripTags(html);
  const seen = new Set<string>();
  const candidates: RawEventCandidate[] = [];

  const anchorPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    const title = normalizeWhitespace(stripTags(match[2]));
    if (!title || !href || title.length < 5 || title.length > 120) continue;
    if (!EVENT_WORDS.some((word) => title.includes(word))) continue;

    const url = absolutizeUrl(href, source.url);
    if (seen.has(url)) continue;
    seen.add(url);

    candidates.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      title,
      url,
      area: source.area,
      snippet: snippetAround(plainText, title),
      publishedAt: new Date().toISOString()
    });

    if (candidates.length >= 30) break;
  }

  return candidates;
}

function snippetAround(plainText: string, title: string): string {
  const index = plainText.indexOf(title);
  if (index === -1) return title;
  const start = Math.max(0, index - 100);
  return plainText.slice(start, start + 900);
}

function normalizeArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function asText(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(value);
  if (value && typeof value === "object" && "#text" in value) return asText((value as { "#text": unknown })["#text"]);
  return "";
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absolutizeUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function normalizeDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
