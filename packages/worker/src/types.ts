export type EventSourceConfig = {
  id: string;
  name: string;
  url: string;
  area: string;
  type: "html" | "rss";
};

export type UserProfile = {
  profileId: string;
  childAge: number;
  interests: string[];
  area: string;
  notificationLeadDays: number;
  createdAt: string;
  updatedAt: string;
};

export type RawEventCandidate = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  url: string;
  area: string;
  snippet: string;
  publishedAt: string;
};

export type EventRecord = {
  eventId: string;
  eventType: "event";
  title: string;
  summary: string;
  url: string;
  area: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  eventDate?: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
  interests: string[];
  createdAt: string;
};

export type PushSubscriptionRecord = {
  profileId: string;
  endpointHash: string;
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  createdAt: string;
  updatedAt: string;
};

/** Cloudflare Workers の環境バインディング（wrangler.toml の vars / secrets） */
export type Env = {
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  PROFILES_TABLE: string;
  EVENTS_TABLE: string;
  SUBSCRIPTIONS_TABLE: string;
  AI_PROVIDER?: string;
  BEDROCK_MODEL_ID: string;
  EVENT_SOURCES_JSON?: string;
  INGEST_INTERVAL_MINUTES?: string;
  // --- AgentCore Web Search（自動発見 / IAM署名で呼ぶ）---
  AGENTCORE_GATEWAY_URL?: string; // 例: https://xxxx.gateway.bedrock-agentcore.us-east-1.amazonaws.com
  WEB_SEARCH_TOOL_NAME?: string; // tools/list で確認した名前。例: events-search___WebSearch
  SEARCH_AREAS?: string; // JSON配列。例: ["新潟県","新潟市"]
  SEARCH_MAX_RESULTS?: string; // 1-25
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
