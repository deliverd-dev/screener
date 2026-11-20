// Who answers when Screener needs a person.
//
// Two kinds, with one shape, so the rest of the app never asks which it has:
//
// - playgroundApprover(): nobody is connected, so the page plays the approver.
//   Requests wait here, in memory, and the "approver's phone" on the page
//   answers them. Nothing leaves your machine.
// - deliverdApprover(): a real request in Deliverd. The people you name get
//   it in Slack, Teams, email or on their phone, and the answer is recorded.
//
// ask() resolves to { allowed, decidedBy, reason }. It never throws for a no.



/** The longest anything waits for a person: four minutes, then it is a no. */
export const ASK_TIMEOUT_MS = 4 * 60_000;

export function playgroundApprover({ timeoutMs = ASK_TIMEOUT_MS } = {}) {
  const pending = new Map();

  function settle(id, answer) {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    clearTimeout(item.timer);
    item.resolve(answer);
    return true;
  }

  return {
    kind: "playground",
    /** Ask the person at the page's phone. `onWaiting` hears once the request exists. */
    ask(request, { signal, onWaiting } = {}) {
      const id = globalThis.crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(
          () => settle(id, { allowed: false, decidedBy: null, reason: "Nobody answered within four minutes, so it was not sent." }),
          timeoutMs
        );
        pending.set(id, {
          resolve,
          timer,
          request: {
            id,
            title: request.title,
            description: request.description ?? "",
            risk: request.risk ?? "medium",
            factors: request.factors ?? [],
            preview: request.preview ?? null,
            asker: request.asker ?? "you",
            createdAt: new Date().toISOString(),
          },
        });
        signal?.addEventListener("abort", () =>
          settle(id, { allowed: false, decidedBy: null, reason: "The page stopped waiting, so the request was withdrawn." })
        );
        onWaiting?.({ id, url: null, approvers: ["you, at the approver's phone"] });
      });
    },
    /** What is waiting, newest last. Requests hold counts and placeholders, never the values. */
    list() {
      return [...pending.values()].map((p) => p.request);
    },
    decide(id, { approve, note }) {
      const reason = note?.trim() ? note.trim().slice(0, 300) : approve ? "" : "The approver said no.";
      return settle(id, approve
        ? { allowed: true, decidedBy: "You (playground approver)", reason }
        : { allowed: false, decidedBy: "You (playground approver)", reason });
    },
  };
}

export function deliverdApprover({ deliverd, approvers, timeoutMs = ASK_TIMEOUT_MS }) {
  return {
    kind: "deliverd",
    async ask(request, { signal, onWaiting } = {}) {
      let approval;
      try {
        approval = await deliverd.approvals.create(
          {
            title: request.title.slice(0, 200),
            description: request.description,
            risk: request.risk ?? "medium",
            ...(approvers?.length ? { approvers } : {}),
            expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
            agent: { name: "Screener" },
            metadata: { source: "screener", asker: request.asker ?? "person", ...(request.metadata ?? {}) },
          },
          signal
        );
      } catch (error) {
        return { allowed: false, decidedBy: null, reason: `Deliverd could not take the request (${error?.message ?? error}), so nothing was sent.` };
      }
      onWaiting?.({ id: approval.id, url: approval.url ?? null, approvers: approvers ?? [] });
      try {
        await approval.wait({ signal, timeout: timeoutMs });
      } catch {
        await approval.cancel().catch(() => {});
        return { allowed: false, decidedBy: null, reason: "Nobody answered in time, so it was not sent. The request was withdrawn." };
      }
      if (approval.approved) return { allowed: true, decidedBy: approval.decidedBy ?? "a person", reason: approval.note ?? "" };
      return {
        allowed: false,
        decidedBy: approval.decidedBy,
        reason: approval.note ?? (approval.expired ? "Nobody answered in time." : "A person said no."),
      };
    },
    list: () => [],
    decide: () => false,
  };
}
