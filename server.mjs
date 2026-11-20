// Screener: the page, and the few routes behind it.
//
//   npm start            then open http://localhost:4173
//
// Everything runs on your machine. Without keys it is a playground: a
// pretend model answers, and you play the approver on the page. Add keys in
// .env (see .env.example) for a real model and real approvers in Deliverd.

import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Deliverd } from "@deliverd/sdk";
import { uiSdkApprovalRoute } from "@deliverd/sdk/adapters";
import { deliverdApprover, playgroundApprover } from "./lib/approvers.mjs";
import { readSendInput, screenAndSend } from "./lib/gate.mjs";
import { modelFromEnv } from "./lib/model.mjs";
import { playgroundUiRoute } from "./lib/ui-route.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const APPROVERS = (process.env.DELIVERD_APPROVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function createApp(env = process.env) {
  const model = modelFromEnv(env);
  const deliverd = env.DELIVERD_API_KEY ? new Deliverd({ apiKey: env.DELIVERD_API_KEY, ...(env.DELIVERD_BASE_URL ? { baseUrl: env.DELIVERD_BASE_URL } : {}) }) : null;
  const approvers = (env.DELIVERD_APPROVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const approver = deliverd ? deliverdApprover({ deliverd, approvers }) : playgroundApprover();

  // An agent on the page wants to press a control marked data-agent-confirm.
  // With Deliverd, Deliverd's own UI SDK route asks the people you named.
  // In the playground, the same question goes to the approver's phone.
  const uiApproval = deliverd
    ? uiSdkApprovalRoute({ deliverd, ...(approvers.length ? { approvers } : {}), timeout: "4m" })
    : playgroundUiRoute(approver);

  const config = {
    mode: deliverd ? "deliverd" : "playground",
    model: { provider: model.provider, label: model.label },
    approvers: deliverd ? (approvers.length ? approvers : ["your organisation's admins"]) : ["you, at the approver's phone"],
  };

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        // Every call from the page carries this header. A page on another site
        // can't add it without the browser asking first, and nothing here says
        // yes, so other sites can't press Send or approve on your behalf.
        if (req.method !== "GET" && req.headers["x-screener"] !== "1") return json(res, 403, { error: "Missing the x-screener header." });
        if (url.pathname === "/api/config") return json(res, 200, config);
        if (url.pathname === "/api/send" && req.method === "POST") return send(req, res, { approver, model });
        if (url.pathname === "/api/approvals" && req.method === "GET") return json(res, 200, { approvals: approver.list() });
        const decide = url.pathname.match(/^\/api\/approvals\/([0-9a-f-]{36})$/);
        if (decide && req.method === "POST") {
          const body = await readJson(req, 4_000);
          const ok = approver.decide(decide[1], { approve: body?.approve === true, note: typeof body?.note === "string" ? body.note : "" });
          return json(res, ok ? 200 : 404, { ok });
        }
        if (url.pathname === "/api/ui-approval" && req.method === "POST") {
          const controller = new AbortController();
          res.on("close", () => controller.abort());
          const body = await readText(req, 16_000);
          const answer = await uiApproval(new Request(new URL(url.pathname, "http://localhost"), { method: "POST", body, headers: { "content-type": "application/json" }, signal: controller.signal }));
          res.writeHead(answer.status, { "content-type": "application/json" });
          return res.end(await answer.text());
        }
        return json(res, 404, { error: "No such route." });
      }
      return serveStatic(url.pathname, res);
    } catch (error) {
      if (!res.headersSent) return json(res, error?.status ?? 500, { error: error?.expose ? error.message : "Something went wrong in Screener." });
      res.end();
    }
  };
}

/** Streams progress as newline-delimited JSON, so the page can show "waiting for a person" while it waits. */
async function send(req, res, { approver, model }) {
  const input = readSendInput(await readJson(req, 1_000_000));
  if (input.error) return json(res, 400, { error: input.error });
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  await screenAndSend(input, { approver, model, signal: controller.signal, emit: (event) => res.write(`${JSON.stringify(event)}\n`) });
  res.end();
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

async function serveStatic(pathname, res) {
  const path = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, "public", path));
  if (!file.startsWith(join(root, "public"))) return json(res, 404, { error: "Not found." });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      // The page talks only to this server. Nothing you type is sent anywhere else from the browser.
      "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  } catch {
    json(res, 404, { error: "Not found." });
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readText(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error("That's too big to check at once."), { status: 413, expose: true }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req, max) {
  const text = await readText(req, max);
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Send JSON."), { status: 400, expose: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const app = createApp();
  http.createServer(app).listen(PORT, HOST, () => {
    const model = modelFromEnv();
    console.log(`\n  👻 Ghost.exe presents: Screener\n`);
    console.log(`  Open http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    console.log(`  Model:      ${model.label}`);
    console.log(`  Approvals:  ${process.env.DELIVERD_API_KEY ? `Deliverd (${APPROVERS.join(", ") || "your organisation's admins"})` : "playground (you approve on the page)"}\n`);
  });
}
