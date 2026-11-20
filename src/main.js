// Screener, in the browser.
import "@ui-sdk/web/tabs";
import "@ui-sdk/web/field";
import "@ui-sdk/web/textarea";
import "@ui-sdk/web/input";
import "@ui-sdk/web/switch";
import "@ui-sdk/web/select";
import "@ui-sdk/web/button";
import "@ui-sdk/web/file-input";
import { createAgent, registerTools } from "@ui-sdk/web/agent";
import { deliverdAllow, deliverdWebMcpAllow } from "@deliverd/sdk/adapters";
import { DATA_KINDS, describeCounts, screen } from "@deliverd/screen";
import { CATEGORY_NAMES, escapeHtml, ghostSvg, statusLine } from "./sponsor.js";
import { readExportFile, scanHistory } from "./history.js";
import { AGENT_PROMPT, SAMPLES } from "./samples.js";
import { DEMO_CONFIG, demoFetch } from "./demo.js";
import { createGhost } from "./haunt.js";
import { renderStats, setWiring, stats } from "./showcase.js";

const $ = (selector) => document.querySelector(selector);
const HEADERS = { "x-screener": "1" };
// The page's own routes: its server's, or answered in this tab for the hosted demo.
let api = (url, init) => fetch(url, init);
const apiFetch = (url, init) => api(url, init);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  config: { mode: "playground", model: { label: "the model" }, approvers: [] },
  files: [], // { name, text }
  checked: null,
  sending: false,
};

// ---------------------------------------------------------------- the sponsor

let ghost = { react() {}, say() {}, enter() {}, setEnabled() {} };
function savedPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

// Ghost.exe reacts to a verdict once you stop typing, not on every key.
let lastReacted = "empty";
let reactTimer = 0;
function ghostOnVerdict(checked) {
  clearTimeout(reactTimer);
  const verdict = checked?.verdict ?? "empty";
  if (verdict === lastReacted) return;
  reactTimer = setTimeout(() => {
    lastReacted = verdict;
    if (verdict === "empty") return;
    const n = Object.keys(checked.replacements ?? {}).length;
    ghost.react(verdict, { el: $("#verdict"), n });
  }, 700);
}

function drawSponsor() {
  $("#sponsor-ghost").innerHTML = ghostSvg("idle", 28);
  $("#footer-ghost").innerHTML = ghostSvg("happy", 36, "Ghost.exe, Screener's sponsor");
}
function status(text) {
  $("#status").textContent = text;
}

// ---------------------------------------------------------------- settings

function allowance() {
  return {
    personalData: $("#personal").checked === true,
    classification: $("#classification").value || "internal",
  };
}
function terms() {
  return $("#terms").value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 100);
}
function message() {
  const parts = [$("#prompt").value];
  for (const file of state.files) parts.push(`\n\n--- ${file.name} ---\n${file.text}`);
  return parts.join("").trim() ? parts.join("") : "";
}

// ---------------------------------------------------------------- live check

let pendingCheck = 0;
function scheduleCheck() {
  clearTimeout(pendingCheck);
  pendingCheck = setTimeout(check, 120);
}

async function check() {
  const text = message();
  if (!text) {
    state.checked = null;
    renderVerdict(null, "");
    return;
  }
  const began = performance.now();
  const checked = await screen(text, {
    model: state.config.model.label,
    allow: allowance(),
    terms: terms().map((term) => ({ term, label: "Your confidential word" })),
  });
  stats.checks++;
  stats.checkMs += performance.now() - began;
  renderStats();
  if (text !== message()) return; // typed again meanwhile
  checked.reasons = checked.reasons.filter((r) => !/nobody can be asked/i.test(r));
  if (checked.verdict === "ask") checked.reasons.push("Redaction can't fix this, so a person decides whether it may go.");
  state.checked = checked;
  renderVerdict(checked, text);
}

const VERDICT_TITLES = {
  allow: "Good to go",
  redact: "Good to go, with placeholders",
  ask: "Needs a person first",
  deny: "Not leaving the house",
};

function renderVerdict(checked, text) {
  const card = $("#verdict");
  const verdict = checked?.verdict ?? "empty";
  card.dataset.verdict = verdict;
  $("#verdict-title").textContent = checked ? VERDICT_TITLES[verdict] : "Waiting for something to check";
  const summary = checked ? describeCounts(checked.counts) : "";
  status(statusLine(checked ? verdict : null, { replaced: Object.keys(checked?.replacements ?? {}).length }));

  $("#reasons").innerHTML = (checked?.reasons ?? []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");

  // One line per category.
  const byCategory = {};
  for (const [kind, n] of Object.entries(checked?.counts ?? {})) {
    const category = DATA_KINDS[kind].category;
    (byCategory[category] ??= []).push(describeCounts({ [kind]: n }));
  }
  $("#finds").innerHTML = Object.entries(byCategory)
    .map(([category, lines]) => {
      return `<li data-category="${category}"><span class="swatch" aria-hidden="true"></span><div><strong>${escapeHtml(CATEGORY_NAMES[category])}</strong><span class="block">${escapeHtml(joinAnd(lines))}</span></div></li>`;
    })
    .join("");

  renderPreview(checked, text);
  updateSend();
  ghostOnVerdict(checked);
}

function renderPreview(checked, text) {
  const pre = $("#preview");
  if (!checked) {
    pre.textContent = "Nothing yet.";
    pre.dataset.empty = "";
    return;
  }
  delete pre.dataset.empty;
  if ($("#show-found").checked) {
    // The original, with what was found marked. It's your text, in your tab.
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const f of [...checked.findings].sort((a, b) => a.start - b.start)) {
      if (f.start < at) continue;
      frag.append(text.slice(at, f.start));
      const mark = document.createElement("mark");
      mark.dataset.category = f.category;
      mark.title = f.label;
      mark.textContent = text.slice(f.start, f.end);
      frag.append(mark);
      at = f.end;
    }
    frag.append(text.slice(at));
    pre.replaceChildren(frag);
    return;
  }
  if (checked.verdict === "deny") {
    pre.textContent = "Nothing. This won't be sent at all.";
    return;
  }
  const shown = checked.verdict === "ask" ? checked.redacted : checked.text;
  const frag = document.createDocumentFragment();
  for (const piece of (shown ?? "").split(/(\[[A-Z]+_\d+\])/)) {
    if (/^\[[A-Z]+_\d+\]$/.test(piece)) {
      const span = document.createElement("span");
      span.className = "placeholder";
      span.textContent = piece;
      frag.append(span);
    } else frag.append(piece);
  }
  if (checked.verdict === "ask") {
    const note = document.createElement("span");
    note.className = "hint block";
    note.textContent = "\n…and only if a person says yes.";
    frag.append(note);
  }
  pre.replaceChildren(frag);
}

function updateSend() {
  const verdict = state.checked?.verdict;
  const blocked = !state.checked || verdict === "deny" || state.sending;
  $("#send").disabled = blocked;
  $("#send").toggleAttribute("disabled", blocked);
  $("#send-hint").textContent = state.sending
    ? "Working on it…"
    : !state.checked
      ? ""
      : verdict === "deny"
        ? "Secrets are never sent. Take the key out and try again."
        : verdict === "ask"
          ? `Pressing Send asks ${approverWords()} first.`
          : verdict === "redact"
            ? "Placeholders go out; the real values come back in the answer."
            : "";
}

function approverWords() {
  return state.config.mode === "deliverd" ? `${joinAnd(state.config.approvers)} in Deliverd` : "the approver's phone, on this page,";
}

// ---------------------------------------------------------------- send

async function send(asker = "person") {
  const text = message();
  if (!text || state.sending) return { status: "nothing" };
  state.sending = true;
  updateSend();
  const result = $("#result");
  result.hidden = false;
  showResult("working", "Checking it again on the server…", "", []);
  let final = { status: "error", error: "No answer from the server." };
  try {
    const response = await api("/api/send", {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ text, allow: allowance(), terms: terms(), asker }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `The server answered ${response.status}.`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const event = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        onSendEvent(event);
        if (event.event === "done") final = event;
      }
    }
  } catch (error) {
    final = { status: "error", error: error.message };
    showResult("declined", "That didn't work", error.message, []);
  } finally {
    state.sending = false;
    updateSend();
    pollPhone();
  }
  if (asker === "agent") {
    const said = {
      sent: ["approved", "Sent", final.decidedBy ? `${final.decidedBy} said yes, and it went with placeholders where it could.` : "Screener let it through."],
      declined: ["declined", "Not sent", `A person said no${final.reason ? `: “${final.reason}”` : "."} The agent was told.`],
      blocked: ["declined", "Not sent", "Screener refused it outright."],
    }[final.status] ?? ["declined", "Not sent", final.error ?? "Something went wrong."];
    logAgent(...said);
  }
  return final;
}

function onSendEvent(event) {
  if (event.event === "waiting") {
    const where =
      state.config.mode === "deliverd"
        ? `Sent to ${joinAnd(event.approvers?.length ? event.approvers : state.config.approvers)} in Deliverd. They see what kind of data it is, never the data.`
        : "It's on the approver's phone, on this page. That's you, today.";
    showResult("waiting", "Waiting for a person", where, [], event.url);
    status("Waiting for a person to decide.");
    stats.asked++;
    renderStats();
    pollPhone();
    setTimeout(() => ghost.react("waiting", { el: state.config.mode === "deliverd" ? $("#result") : $("#phone") }), 350);
  } else if (event.event === "sending") {
    showResult("working", `Sending to ${event.model}…`, "", []);
  } else if (event.event === "done") {
    if (event.status === "sent") {
      const who = event.decidedBy ? ` ${event.decidedBy} said yes.` : "";
      showResult("sent", "Sent", `${event.model} answered.${who}`, [
        ["What the model saw", event.sent],
        ["The answer, with your real values put back", event.answer],
      ]);
      status(event.verdict === "redact" || event.decidedBy ? "Sent. The model never saw the real values, and the answer has them back." : "Sent.");
      if (event.decidedBy) stats.yes++;
      stats.placeholders += (event.sent?.match(/\[[A-Z_]+_\d+\]/g) ?? []).length;
      renderStats();
      ghost.react("sent", { text: event.decidedBy ? "A person said yes. Delivered, real values back in." : undefined });
    } else if (event.status === "declined") {
      showResult("declined", "Not sent: a person said no", `${event.decidedBy ? `${event.decidedBy}: ` : ""}${event.reason || "No reason given."}`, []);
      status("A person said no, so nothing went out.");
      stats.no++;
      renderStats();
      ghost.react("declined", { el: $("#result") });
    } else if (event.status === "blocked") {
      showResult("declined", "Not sent", (event.reasons ?? []).join(" "), []);
      ghost.react("deny", { el: $("#result") });
    } else if (event.status === "error") {
      showResult("declined", "That didn't work", event.error, []);
    }
  }
}

function showResult(stateName, title, detail, texts, link) {
  const card = $("#result");
  card.dataset.state = stateName;
  $("#result-title").textContent = title;
  $("#result-detail").textContent = detail;
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = " Open it in Deliverd";
    $("#result-detail").append(a);
  }
  $("#result-texts").replaceChildren(
    ...texts.map(([label, text]) => {
      const box = document.createElement("div");
      box.innerHTML = `<p class="kicker"></p><pre class="text"></pre>`;
      box.querySelector("p").textContent = label;
      box.querySelector("pre").textContent = text;
      return box;
    })
  );
}

// ---------------------------------------------------------------- the approver's phone (playground)

let phoneTimer = 0;
async function pollPhone() {
  if (state.config.mode === "deliverd") return;
  clearTimeout(phoneTimer);
  let approvals = [];
  try {
    approvals = (await (await api("/api/approvals", { headers: HEADERS })).json()).approvals ?? [];
  } catch {}
  renderPhone(approvals);
  if (approvals.length || state.sending || agentRunning) phoneTimer = setTimeout(pollPhone, 700);
}

function renderPhone(approvals) {
  const phone = $("#phone");
  phone.hidden = approvals.length === 0;
  const body = $("#phone-body");
  const shown = new Set([...body.querySelectorAll("[data-id]")].map((el) => el.dataset.id));
  if (approvals.length === shown.size && approvals.every((a) => shown.has(a.id))) return;
  body.replaceChildren(
    ...approvals.map((a) => {
      const el = document.createElement("article");
      el.className = "ask";
      el.dataset.id = a.id;
      el.innerHTML = `
        <p class="app"><span class="dot"></span> Deliverd · now</p>
        <h3></h3>
        <p class="desc"></p>
        <pre class="text small" hidden></pre>
        <input class="note" placeholder="Reason (optional)" aria-label="Reason" />
        <div class="answers">
          <button type="button" class="decline">Decline</button>
          <button type="button" class="approve">Approve</button>
        </div>`;
      el.querySelector("h3").textContent = a.title;
      el.querySelector(".desc").textContent = a.description;
      if (a.preview) {
        el.querySelector("pre").hidden = false;
        el.querySelector("pre").textContent = a.preview;
      }
      const answer = async (approve) => {
        el.classList.add("answered");
        await api(`/api/approvals/${a.id}`, {
          method: "POST",
          headers: { ...HEADERS, "content-type": "application/json" },
          body: JSON.stringify({ approve, note: el.querySelector(".note").value }),
        });
        pollPhone();
      };
      el.querySelector(".approve").addEventListener("click", () => answer(true));
      el.querySelector(".decline").addEventListener("click", () => answer(false));
      return el;
    })
  );
  if (approvals.length) phone.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
}

// ---------------------------------------------------------------- the agent bridge

const toPerson = deliverdAllow({ endpoint: "/api/ui-approval", headers: HEADERS, fetch: apiFetch });
let agentRunning = false;

const agent = createAgent({
  timeout: 5 * 60_000,
  async allow(step, context) {
    stats.steps++;
    renderStats();
    if (!step.confirm) {
      ghost.react("agent-step", { el: stepTarget(step), text: step.action === "press" ? "The agent pressed Send. Screener checks it again." : "An agent is typing. I'm watching." });
      const sending = step.action === "press" && /send/i.test(step.label ?? "");
      logAgent(
        "allowed",
        describeStep(step),
        sending ? "Not marked, so the agent may press it. Screener still checks what it sends, on the server." : "Not marked, so it ran without asking anyone."
      );
      return true;
    }
    const entry = logAgent("waiting", describeStep(step), `Marked: “${step.confirm}”. Asking ${approverWords().replace(/,$/, "")}…`);
    status("The agent wants to loosen the rules. A person has to say yes first.");
    stats.held++;
    stats.asked++;
    renderStats();
    ghost.react("agent-held", { el: stepTarget(step) });
    pollPhone();
    const ok = await toPerson(step, context);
    ok ? stats.yes++ : stats.no++;
    renderStats();
    entry.classList.replace("waiting", ok ? "approved" : "declined");
    entry.querySelector(".d").textContent = ok ? "A person said yes, so it ran." : "A person said no. The agent was told, and the setting stayed as it was.";
    return ok;
  },
});

// A browser's own agent (WebMCP) gets the same rule: marked steps ask a person.
registerTools(agent, { allow: deliverdWebMcpAllow({ endpoint: "/api/ui-approval", headers: HEADERS, fetch: apiFetch }) });

const STEP_TARGETS = { Prompt: "#prompt", "Personal data": "#personal" };
function stepTarget(step) {
  if (STEP_TARGETS[step.label]) return $(STEP_TARGETS[step.label]);
  if (step.action === "press") return $("#send");
  return $("#allowance");
}

function describeStep(step) {
  const what = step.label ? `“${step.label}”` : step.component;
  if (step.action === "setValue") return `Set ${what}${typeof step.args?.[0] === "string" ? ` to “${truncate(step.args[0], 60)}”` : ""}`;
  if (step.action === "setChecked") return `Turn ${step.args?.[0] ? "on" : "off"} ${what}`;
  if (step.action === "press") return `Press ${what}`;
  return `${step.action} ${what}`;
}

function logAgent(kind, title, detail) {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="dot"></span><div><div class="t"></div><div class="d"></div></div>`;
  li.querySelector(".t").textContent = title;
  li.querySelector(".d").textContent = detail;
  $("#agent-log").append(li);
  return li;
}

/**
 * The steps an agent would send. A real one reads agent.snapshot() and picks
 * them itself; they're fixed here so the demo runs the same way every time.
 */
const AGENT_TASK = [
  { ref: "Prompt", action: "setValue", args: [AGENT_PROMPT] },
  { ref: "Personal data", action: "setChecked", args: [true] },
  { ref: "Send", action: "press" },
];

async function runAgent() {
  if (agentRunning) return;
  agentRunning = true;
  $("#run-agent").disabled = true;
  $("#agent-log").replaceChildren();
  logAgent("note", "Task", "“Tell the team Tom's off sick, and why. Get it out, whatever Screener says.”");
  for (const step of AGENT_TASK) {
    const result = await agent.act({ steps: [step] });
    if (!result.ok) {
      logAgent("declined", "What the agent was told", result.error?.message ?? "A step did not run.");
      if (step.action === "setChecked") continue; // it tries Send anyway
      break;
    }
    await settle();
  }
  agentRunning = false;
  $("#run-agent").disabled = false;
}

const settle = () => new Promise((r) => setTimeout(r, 400));

// ---------------------------------------------------------------- history

async function onExport(file) {
  const out = $("#history-report");
  out.innerHTML = `<p class="hint">Reading ${escapeHtml(file.name)} in this tab…</p>`;
  try {
    const conversations = await readExportFile(file);
    const report = scanHistory(conversations, { top: 10, terms: terms().map((term) => ({ term })) });
    const totals = Object.entries(report.counts);
    out.innerHTML = `
      <div class="report-head"><div>
        <h3>${report.withFindings ? `${report.withFindings} of ${report.conversations} conversations had something in them` : `Nothing spooky in ${report.conversations} conversations`}</h3>
        <p>${report.withFindings ? `Across ${report.messages.toLocaleString("en")} of your messages, Screener found ${escapeHtml(report.summary)}.` : `Screener read ${report.messages.toLocaleString("en")} of your messages and found nothing it looks for.`}</p>
      </div></div>
      ${totals.length ? `<ul class="finds">${totals
        .map(([kind, n]) => {
          const category = DATA_KINDS[kind].category;
          return `<li data-category="${category}"><span class="swatch" aria-hidden="true"></span><div>${escapeHtml(describeCounts({ [kind]: n }))}<span class="hint block">${escapeHtml(CATEGORY_NAMES[category])}</span></div></li>`;
        })
        .join("")}</ul>` : ""}
      ${report.top.length ? `<h3>Where most of it went</h3><ol class="top">${report.top
        .map((c) => `<li><strong>${escapeHtml(c.title || "Untitled")}</strong>${c.created ? ` <span class="hint">${escapeHtml(c.created.slice(0, 10))}</span>` : ""}<span class="hint block">${escapeHtml(describeCounts(c.counts))}</span></li>`)
        .join("")}</ol>` : ""}
      <p class="hint">Counts and titles only. The values stayed where they were, in your file and in this tab.</p>`;
    status(report.withFindings ? "Your chat history has been busy." : "Nothing found in your chat history.");
    ghost.react("history", { el: out, found: report.withFindings > 0 });
  } catch (error) {
    out.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

// ---------------------------------------------------------------- wiring

function joinAnd(list) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}
function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

async function start() {
  drawSponsor();
  const haunted = savedPref("screener.ghost", true);
  ghost = createGhost({ enabled: haunted });
  $("#haunted").checked = haunted;
  $("#haunted").addEventListener("checkedchange", () =>
    setTimeout(() => {
      const on = $("#haunted").checked === true;
      savePref("screener.ghost", on);
      ghost.setEnabled(on);
    })
  );
  $("#wiring").addEventListener("checkedchange", () => setTimeout(() => setWiring($("#wiring").checked === true)));
  try {
    const response = await fetch("/api/config", { headers: HEADERS });
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("no server");
    state.config = await response.json();
    // The hosted demo answers /api/config with a static file saying so.
    if (state.config.mode === "demo") throw new Error("demo");
  } catch {
    // No server behind this page: run the demo in the tab.
    api = demoFetch();
    state.config = DEMO_CONFIG;
    $("#demo-note").hidden = false;
  }
  const { mode, model } = state.config;
  $("#mode-pill").textContent =
    mode === "deliverd" ? "Approvals: Deliverd" : mode === "demo" ? "Demo: runs in your browser" : "Playground: you're the approver";
  $("#mode-pill").dataset.mode = mode;
  $("#model-pill").textContent = `Model: ${model.label}`;
  document.querySelectorAll(".model-name").forEach((el) => (el.textContent = model.label));

  $("#sample-buttons").replaceChildren(
    ...SAMPLES.map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s.label;
      b.addEventListener("click", () => {
        $("#prompt").value = s.text;
        $("#prompt").dispatchEvent(new Event("input", { bubbles: true }));
        scheduleCheck();
      });
      return b;
    })
  );

  $("#prompt").addEventListener("input", scheduleCheck);
  document.querySelector("ui-textarea").addEventListener("valuechange", scheduleCheck);
  $("#terms").addEventListener("input", scheduleCheck);
  $("#personal").addEventListener("checkedchange", () => setTimeout(scheduleCheck));
  $("#classification").addEventListener("valuechange", () => setTimeout(scheduleCheck));
  $("#show-found").addEventListener("checkedchange", () => setTimeout(() => renderPreview(state.checked, message())));

  $("#files").addEventListener("valuechange", async (event) => {
    const files = [...event.detail.value];
    state.files = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
    scheduleCheck();
  });
  $("#files").addEventListener("reject", (event) => {
    const el = $("#rejected");
    el.hidden = false;
    el.textContent = `Screener can't read ${joinAnd(event.detail.value.map((r) => r.file?.name ?? "a file"))} yet: only text files up to 1 MB. Nothing from them will be sent.`;
  });

  $("#send").addEventListener("action", (event) => {
    event.detail?.waitUntil?.(send(event.detail?.source === "agent" ? "agent" : "person"));
  });

  $("#run-agent").addEventListener("click", runAgent);

  $("#export").addEventListener("valuechange", (event) => {
    const file = event.detail.value[0];
    if (file) onExport(file);
  });

  renderVerdict(null, "");
  renderStats();
  ghost.enter();
}

start();

// For poking at from the console, and for the screenshot script.
window.screener = { agent, send, runAgent, check, get ghost() { return ghost; }, stats };
