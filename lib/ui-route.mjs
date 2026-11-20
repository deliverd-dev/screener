// The UI SDK approval protocol (the one deliverdAllow speaks), answered by
// the approver's phone on the page instead of Deliverd. Used by the local
// server's playground and by the browser-only demo.
import { describeStep } from "@deliverd/sdk/adapters";

export function playgroundUiRoute(approver) {
  return async (request) => {
    let body;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return Response.json({ allowed: false, reason: "The step could not be read." }, { status: 400 });
    }
    const step = body?.step;
    if (!step || typeof step.confirm !== "string" || typeof step.action !== "string") {
      return Response.json({ allowed: false, reason: "Only marked steps are asked about." }, { status: 403 });
    }
    const described = describeStep(step, { via: body.via });
    const decision = await approver.ask(
      { title: described.title, description: described.description, risk: described.risk, asker: body.via === "webmcp" ? "webmcp" : "agent" },
      { signal: request.signal }
    );
    return Response.json(decision.allowed ? { allowed: true, decidedBy: decision.decidedBy } : { allowed: false, reason: decision.reason });
  };
}

