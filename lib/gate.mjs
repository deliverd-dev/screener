// What happens when someone presses Send: screen, decide, maybe ask, then send.
//
// The page screens as you type so you can see what it found, but the page
// is never trusted with the decision. This runs the same Deliverd Screen
// check again here, on the server, on exactly the text that would be sent.

import { describeCounts, screen, SCREEN_CLASSIFICATIONS } from "@deliverd/screen";

export const MAX_TEXT = 200_000;
export const MAX_TERMS = 100;

/** Reads and checks what the page sent. Returns { error } or the cleaned input. */
export function readSendInput(raw) {
  if (typeof raw !== "object" || raw === null) return { error: "Send a JSON object." };
  const { text, allow = {}, terms = [], asker = "person" } = raw;
  if (typeof text !== "string" || !text.trim()) return { error: "There's nothing to send." };
  if (text.length > MAX_TEXT) return { error: `That's more than ${MAX_TEXT.toLocaleString("en")} characters. Screener can't take that much at once.` };
  if (typeof allow !== "object" || allow === null) return { error: "allow must be an object." };
  const classification = allow.classification ?? "internal";
  if (!SCREEN_CLASSIFICATIONS.includes(classification)) return { error: "Unknown classification." };
  if (allow.personalData !== undefined && typeof allow.personalData !== "boolean") return { error: "personalData must be true or false." };
  if (!Array.isArray(terms) || terms.length > MAX_TERMS || terms.some((t) => typeof t !== "string" || !t.trim() || t.length > 100)) {
    return { error: `terms must be up to ${MAX_TERMS} words or phrases, each up to 100 characters.` };
  }
  if (asker !== "person" && asker !== "agent" && asker !== "webmcp") return { error: "Unknown asker." };
  return {
    text,
    allow: { classification, personalData: allow.personalData === true },
    terms: terms.map((term) => ({ term: term.trim(), label: "Your confidential word" })),
    asker,
  };
}

const ASKERS = { person: "Someone using Screener", agent: "An agent driving Screener", webmcp: "The browser's own agent, through WebMCP" };

/**
 * Screens `input.text` and sends it if it may go. `emit` hears progress:
 * { event: "screened" }, { event: "waiting" } when a person is asked, then
 * one { event: "done" }. Values found are never put in an event, except in
 * the model's answer, where `restore()` puts them back for you.
 */
export async function screenAndSend(input, { approver, model, signal, emit = () => {} }) {
  const options = { model: model.label, allow: input.allow, terms: input.terms };
  const checked = withOurReasons(await screen(input.text, options));
  const summary = describeCounts(checked.counts);
  emit({ event: "screened", verdict: checked.verdict, counts: checked.counts, summary, reasons: checked.reasons });

  if (checked.verdict === "deny") {
    return done(emit, { status: "blocked", verdict: "deny", reasons: checked.reasons, summary });
  }

  let toSend = checked.text;
  let restore = checked.restore;
  let decidedBy = null;

  if (checked.verdict === "ask") {
    const decision = await approver.ask(
      {
        title: `Send ${summary || "this text"} to ${model.label}?`,
        description: [
          `${ASKERS[input.asker]} wants to send a prompt to ${model.label}.`,
          `Found: ${summary}.`,
          "You're seeing what kind of data it holds, not the data itself.",
          "If you say yes, personal details the model isn't approved for are still swapped for placeholders.",
        ].join("\n\n"),
        risk: "high",
        factors: checked.reasons,
        // The playground approver is this page, on this machine, so it may see
        // the text with placeholders in. Deliverd is only ever told the counts.
        preview: approver.kind === "playground" ? checked.redacted : null,
        asker: input.asker,
        metadata: { counts: checked.counts, model: model.label },
      },
      { signal, onWaiting: (info) => emit({ event: "waiting", ...info }) }
    );
    if (!decision.allowed) {
      return done(emit, { status: "declined", verdict: "ask", reasons: checked.reasons, summary, decidedBy: decision.decidedBy, reason: decision.reason });
    }
    decidedBy = decision.decidedBy;
    // A yes covers what redaction can't fix. What it can fix, it still does.
    const softened = await screen(input.text, { ...options, policy: { notRedactable: "redact" } });
    toSend = softened.text ?? input.text;
    restore = softened.restore;
  }

  emit({ event: "sending", model: model.label });
  let raw;
  try {
    raw = await model.complete(toSend, { signal });
  } catch (error) {
    return done(emit, { status: "error", verdict: checked.verdict, summary, error: `${model.label} didn't answer: ${error?.message ?? error}` });
  }
  return done(emit, {
    status: "sent",
    verdict: checked.verdict,
    summary,
    reasons: checked.reasons,
    decidedBy,
    sent: toSend,
    answerAsWritten: raw,
    answer: restore(raw),
    model: model.label,
  });
}

/**
 * Deliverd Screen on its own can't ask anyone, so its reason for an ask says
 * so. Screener can, so that sentence is replaced with what it will do.
 */
export function withOurReasons(checked) {
  const reasons = checked.reasons.filter((r) => !/nobody can be asked/i.test(r));
  if (checked.verdict === "ask") reasons.push("Redaction can't fix this, so a person decides whether it may go.");
  return { ...checked, reasons };
}

function done(emit, result) {
  emit({ event: "done", ...result });
  return result;
}
