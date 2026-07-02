import { getRequestListener } from "@hono/node-server";
import { app } from "../packages/worker/src/index.js";

// Node ランタイム。収集は最大60秒まで許可。
export const config = { maxDuration: 60 };

// Cloudflare の ExecutionContext 相当のスタブ（cron の waitUntil 用）
const execCtx = {
  waitUntil(promise: Promise<unknown>) {
    void Promise.resolve(promise).catch((error) => console.error("waitUntil error", error));
  },
  passThroughOnException() {
    /* noop */
  }
};

// vercel.json の rewrite で /api/* がこの関数に来る。
// worker アプリのルートは "/" 始まり（/health, /events, /admin/... など）なので、
// 先頭の "/api" を除去してから渡す。
export default getRequestListener((req) => {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  const stripped = new Request(url.toString(), req);
  return app.fetch(stripped, process.env as unknown as Record<string, string>, execCtx as never);
});
