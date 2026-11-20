// The browser-only demo: the same routes the local server answers, answered
// here in the tab instead. Used when the page is served without its server,
// as on screener.deliverd.dev, so nothing you type ever leaves the browser.
//
// It runs the same code the server does: Deliverd Screen's check, the same
// send logic, the approver's phone and the pretend model. There is no real
// model and no Deliverd connection here; run it yourself for those.
import { playgroundApprover } from "../lib/approvers.mjs";
import { readSendInput, screenAndSend } from "../lib/gate.mjs";
import { modelFromEnv } from "../lib/model.mjs";
import { playgroundUiRoute } from "../lib/ui-route.mjs";

export const DEMO_CONFIG = {
  mode: "demo",
  model: { provider: "echo", label: "the pretend model" },
  approvers: ["you, at the approver's phone"],
};

/** A fetch() for the page's own /api routes, answered in this tab. */
export function demoFetch() {
  const approver = playgroundApprover();
  const model = modelFromEnv({});
  const uiRoute = playgroundUiRoute(approver);

  return async function fetchHere(url, init = {}) {
    const path = new URL(url, location.href).pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : "";

    if (path === "/api/config") return Response.json(DEMO_CONFIG);
    if (path === "/api/approvals" && method === "GET") return Response.json({ approvals: approver.list() });
    const decide = path.match(/^\/api\/approvals\/([0-9a-f-]{36})$/);
    if (decide && method === "POST") {
      const answer = JSON.parse(body || "{}");
      const ok = approver.decide(decide[1], { approve: answer.approve === true, note: typeof answer.note === "string" ? answer.note : "" });
      return Response.json({ ok }, { status: ok ? 200 : 404 });
    }
    if (path === "/api/ui-approval" && method === "POST") {
      return uiRoute(new Request(new URL(path, location.href), { method: "POST", body, signal: init.signal }));
    }
    if (path === "/api/send" && method === "POST") {
      let raw;
      try {
        raw = JSON.parse(body);
      } catch {
        return Response.json({ error: "Send JSON." }, { status: 400 });
      }
      const input = readSendInput(raw);
      if (input.error) return Response.json({ error: input.error }, { status: 400 });
      // The same newline-delimited events the server streams.
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          await screenAndSend(input, {
            approver,
            model,
            signal: init.signal,
            emit: (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
          });
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
    }
    return Response.json({ error: "No such route." }, { status: 404 });
  };
}
