import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { playgroundApprover } from "../lib/approvers.mjs";
import { readSendInput, screenAndSend } from "../lib/gate.mjs";
import { modelFromEnv } from "../lib/model.mjs";
import { createApp } from "../server.mjs";
import { fileInZip } from "../src/history.js";
import { ghostSvg, statusLine } from "../src/sponsor.js";
import http from "node:http";

const echo = modelFromEnv({});
const input = (text, extra = {}) => readSendInput({ text, ...extra });

async function run(text, { approve, extra } = {}) {
  const approver = playgroundApprover({ timeoutMs: 2_000 });
  const events = [];
  const pending = screenAndSend(input(text, extra), { approver, model: echo, emit: (e) => events.push(e) });
  if (approve !== undefined) {
    for (let i = 0; i < 50 && !approver.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    const [ask] = approver.list();
    assert.ok(ask, "a person was asked");
    assert.ok(!JSON.stringify(ask).includes("tom.walsh@example.com"), "the approver never sees a value");
    approver.decide(ask.id, { approve, note: approve ? "" : "Not today" });
  }
  return { result: await pending, events };
}

test("clean text is sent as it is", async () => {
  const { result } = await run("Write a haiku about Dublin rain.");
  assert.equal(result.status, "sent");
  assert.equal(result.verdict, "allow");
  assert.equal(result.sent, "Write a haiku about Dublin rain.");
});

test("personal data goes out as placeholders and comes back in the answer", async () => {
  const { result } = await run("Reply to mary.byrne@example.ie about IBAN IE29AIBK93115212345678");
  assert.equal(result.verdict, "redact");
  assert.ok(!result.sent.includes("mary.byrne@example.ie"));
  assert.match(result.sent, /\[EMAIL_1\]/);
  assert.ok(result.answer.includes("mary.byrne@example.ie"), "restored in the answer");
});

test("allowing personal data lets it through", async () => {
  const { result } = await run("Reply to mary.byrne@example.ie", { extra: { allow: { personalData: true, classification: "confidential" } } });
  assert.equal(result.verdict, "allow");
});

test("a secret is never sent", async () => {
  const { result, events } = await run("key: AKIAIOSFODNN7EXAMPLE secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  assert.equal(result.status, "blocked");
  assert.ok(!events.some((e) => e.event === "sending"));
});

const HEALTH = "Tom (tom.walsh@example.com) was diagnosed with Crohn's disease and has a new prescription.";

test("special-category data waits for a person, and a no sends nothing", async () => {
  const { result, events } = await run(HEALTH, { approve: false });
  assert.equal(result.status, "declined");
  assert.equal(result.reason, "Not today");
  assert.ok(events.some((e) => e.event === "waiting"));
  assert.ok(!events.some((e) => e.event === "sending"));
});

test("a yes sends it, with placeholders where they still fit", async () => {
  const { result } = await run(HEALTH, { approve: true });
  assert.equal(result.status, "sent");
  assert.match(result.decidedBy, /playground/);
  assert.ok(!result.sent.includes("tom.walsh@example.com"));
  assert.match(result.sent, /Crohn's/);
  assert.ok(result.answer.includes("tom.walsh@example.com"));
});

test("Screener's own reason replaces 'nobody can be asked'", async () => {
  const { result } = await run(HEALTH, { approve: false });
  assert.ok(result.reasons.every((r) => !/nobody can be asked/i.test(r)));
});

test("bad input is refused", () => {
  assert.ok(readSendInput({ text: "" }).error);
  assert.ok(readSendInput({ text: "x", allow: { classification: "secret-squirrel" } }).error);
  assert.ok(readSendInput({ text: "x", terms: ["a".repeat(101)] }).error);
  assert.ok(readSendInput({ text: "x", asker: "mallory" }).error);
});

async function serve(env = {}) {
  const server = http.createServer(createApp(env));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

test("POSTs without the page's header are refused, so other sites can't approve", async () => {
  const { base, close } = await serve();
  try {
    const res = await fetch(`${base}/api/send`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
    assert.equal(res.status, 403);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.mode, "playground");
    assert.equal(config.model.provider, "echo");
  } finally {
    await close();
  }
});

test("an agent's marked step goes to the approver's phone (UI SDK protocol)", async () => {
  const { base, close } = await serve();
  const headers = { "x-screener": "1", "content-type": "application/json" };
  try {
    const step = { ref: "c5", component: "switch", label: "Personal data", action: "setChecked", args: [true], confirm: "Lets the AI model receive more" };
    const answer = fetch(`${base}/api/ui-approval`, { method: "POST", headers, body: JSON.stringify({ step, nonce: "n1" }) }).then((r) => r.json());
    let list = [];
    for (let i = 0; i < 50 && !list.length; i++) {
      await new Promise((r) => setTimeout(r, 20));
      list = (await (await fetch(`${base}/api/approvals`)).json()).approvals;
    }
    assert.equal(list.length, 1);
    await fetch(`${base}/api/approvals/${list[0].id}`, { method: "POST", headers, body: JSON.stringify({ approve: false, note: "No" }) });
    assert.deepEqual(await answer, { allowed: false, reason: "No" });

    const unmarked = await fetch(`${base}/api/ui-approval`, { method: "POST", headers, body: JSON.stringify({ step: { ...step, confirm: undefined }, nonce: "n2" }) });
    assert.equal(unmarked.status, 403);
  } finally {
    await close();
  }
});

test("the static server stays inside public/", async () => {
  const { base, close } = await serve();
  try {
    assert.equal((await fetch(`${base}/..%2fserver.mjs`)).status, 404);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  } finally {
    await close();
  }
});

test("a chat export zip is read with the browser's own tools", async () => {
  const json = Buffer.from(JSON.stringify([{ title: "Hi", mapping: {} }]));
  const zip = makeZip("export/conversations.json", json);
  assert.equal(await fileInZip(new Uint8Array(zip), "conversations.json"), json.toString());
  assert.equal(await fileInZip(new Uint8Array(zip), "nope.json"), null);
});

test("there is a status line for every verdict, and the sponsor draws", () => {
  for (const v of ["allow", "redact", "ask", "deny", null]) assert.ok(statusLine(v));
  assert.match(ghostSvg("happy", 32), /^<svg/);
});

/** One deflated file in a zip, enough to test the reader. */
function makeZip(name, data) {
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}
