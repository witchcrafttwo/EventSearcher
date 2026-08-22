import type { EventItem } from "./api";

/**
 * イベント一覧のキーワード検索。
 * サーバーへ追加リクエストを送らず、取得済みの一覧に対してフロント側で絞り込む。
 * 判定はOR一致（入力した語のうち1つでも当たれば対象）で、一致数の多い順に並べる。
 */

/** 全角英数を半角へ、英字を小文字へ揃える（表記ゆれの吸収） */
export function normalize(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 入力を語に分割する。半角/全角スペース区切り、前後の空白と空要素は除去。 */
export function parseKeywords(input: string): string[] {
  const normalized = normalize(input).trim();
  if (!normalized) return [];
  return normalized.split(/[\s\u3000]+/).filter(Boolean);
}

/** 検索対象フィールド: タイトル・要約本文・会場名・住所・エリア・カテゴリ */
function haystack(event: EventItem): string {
  return normalize(
    [event.title, event.summary, event.venue, event.address, event.area, event.category]
      .filter(Boolean)
      .join(" ")
  );
}

/** 入力した語のうち、いくつ一致したかを返す */
export function matchCount(event: EventItem, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const text = haystack(event);
  let count = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) count++;
  }
  return count;
}

/**
 * OR一致で絞り込み、一致数の多い順に並べ替える。
 * 一致数が同じ場合は渡された順序（既存の並び替え結果）を保つ。
 * 入力が空なら元の配列をそのまま返す。
 */
export function filterByKeywords(events: EventItem[], input: string): EventItem[] {
  const keywords = parseKeywords(input);
  if (keywords.length === 0) return events;

  const hits: Array<{ event: EventItem; count: number; index: number }> = [];
  events.forEach((event, index) => {
    const count = matchCount(event, keywords);
    if (count > 0) hits.push({ event, count, index });
  });

  hits.sort((a, b) => b.count - a.count || a.index - b.index);
  return hits.map((hit) => hit.event);
}
