import { Hono } from "hono";
import { app as api } from "../packages/worker/src/index.js";

// Node ランタイム（AI/DynamoDB呼び出しがあるため）。収集は最大60秒まで許可。
export const config = { maxDuration: 60 };

// API は /api 配下で配信する（フロントは VITE_API_BASE_URL=/api で呼ぶ）
const app = new Hono().basePath("/api");
app.route("/", api);

// Cloudflare の ExecutionContext 相当のスタブ（cron の waitUntil 用）
const execCtx = {
  waitUntil(promise: Promise<unknown>) {
    void Promise.resolve(promise).catch((error) => console.error("waitUntil error", error));
  },
  passThroughOnException() {
    /* noop */
  }
};

// Vercel(Web Handler)。bindings として process.env を明示的に渡す。
export default (req: Request) => app.fetch(req, process.env as unknown as Record<string, string>, execCtx as never);
