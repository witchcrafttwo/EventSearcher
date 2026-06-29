import { converse } from "./bedrock.js";
import type { Env, EventRecord, RawEventCandidate } from "./types.js";

type AiEvent = {
  title?: string;
  summary?: string;
  eventDate?: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
  interests?: string[];
};

type EnrichedEvent = Omit<EventRecord, "eventId" | "eventType" | "createdAt">;

export async function enrichCandidate(env: Env, candidate: RawEventCandidate): Promise<EnrichedEvent> {
  const fallback = fallbackEvent(candidate);
  try {
    const text = await converse(env, buildPrompt(candidate));
    const parsed = JSON.parse(extractJson(text)) as AiEvent;
    return mergeParsedEvent(parsed, fallback);
  } catch {
    return fallback;
  }
}

function mergeParsedEvent(parsed: AiEvent, fallback: EnrichedEvent): EnrichedEvent {
  return {
    ...fallback,
    title: parsed.title?.trim() || fallback.title,
    summary: parsed.summary?.trim() || fallback.summary,
    eventDate: parsed.eventDate || fallback.eventDate,
    targetAgeMin: parsed.targetAgeMin ?? fallback.targetAgeMin,
    targetAgeMax: parsed.targetAgeMax ?? fallback.targetAgeMax,
    interests: normalizeInterests(parsed.interests ?? fallback.interests)
  };
}

function buildPrompt(candidate: RawEventCandidate): string {
  return [
    "以下の地域イベント候補を、子ども向けレジャー通知アプリ用にJSONだけで整理してください。",
    "不明な項目は省略し、誇張せず、本文にない情報は作らないでください。",
    "",
    "JSON schema:",
    '{"title":"string","summary":"string","eventDate":"YYYY-MM-DD","targetAgeMin":number,"targetAgeMax":number,"interests":["string"]}',
    "",
    `source: ${candidate.sourceName}`,
    `area: ${candidate.area}`,
    `title: ${candidate.title}`,
    `url: ${candidate.url}`,
    `snippet: ${candidate.snippet}`
  ].join("\n");
}

function fallbackEvent(candidate: RawEventCandidate): EnrichedEvent {
  return {
    title: candidate.title,
    summary: candidate.snippet || candidate.title,
    url: candidate.url,
    area: candidate.area,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    publishedAt: candidate.publishedAt,
    interests: inferInterests(`${candidate.title} ${candidate.snippet}`)
  };
}

function inferInterests(text: string): string[] {
  const mapping: Array<[string, string[]]> = [
    ["工作", ["工作", "ものづくり", "ワークショップ"]],
    ["自然", ["自然", "公園", "森", "虫", "星", "観察"]],
    ["科学", ["科学", "実験", "ロボット", "プログラミング"]],
    ["音楽", ["音楽", "コンサート", "演奏"]],
    ["スポーツ", ["スポーツ", "運動", "サッカー", "野球"]],
    ["読書", ["図書館", "絵本", "読み聞かせ"]],
    ["アート", ["美術", "アート", "展示", "絵"]]
  ];
  const hits = mapping.filter(([, words]) => words.some((word) => text.includes(word))).map(([interest]) => interest);
  return hits.length ? hits : ["イベント"];
}

function normalizeInterests(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean).slice(0, 8);
  return normalized.length ? normalized : ["イベント"];
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in model response");
  return text.slice(start, end + 1);
}
