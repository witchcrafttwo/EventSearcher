import { Hono } from "hono";
import { handle } from "hono/vercel";
import { app as api } from "../packages/worker/src/index.js";

// Node ランタイム（AI/DynamoDB呼び出しがあるため）。収集は最大60秒まで許可。
export const config = { maxDuration: 60 };

// API は /api 配下で配信する（フロントは VITE_API_BASE_URL=/api で呼ぶ）
const app = new Hono().basePath("/api");
app.route("/", api);

export default handle(app);
