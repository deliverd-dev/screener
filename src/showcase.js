// "Under the hood": live counts of what Vercel UI SDK and Deliverd did in this
// tab, and a wiring view that labels each part of the page with what built it.
// Every number is counted here, in this session. Nothing is made up.

const UI_TAGS = ["ui-tabs", "ui-field", "ui-textarea", "ui-input", "ui-switch", "ui-select", "ui-button", "ui-file-input"];

export const stats = {
  checks: 0,
  checkMs: 0,
  placeholders: 0,
  steps: 0,
  held: 0,
  asked: 0,
  yes: 0,
  no: 0,
  blocked: 0,
};

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Count up to a number, briefly. */
function tween(el, to) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  const fmt = (n) => (Number.isInteger(to) ? Math.round(n).toLocaleString("en") : n.toFixed(1));
  if (reduced() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 450);
    el.textContent = fmt(from + (to - from) * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.closest(".stat")?.animate([{ transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 300 });
}

export function renderStats() {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) tween(el, value);
  };
  const tags = UI_TAGS.filter((t) => document.querySelector(t));
  set("stat-components", document.querySelectorAll(UI_TAGS.join(",")).length);
  set("stat-kinds", tags.length);
  set("stat-steps", stats.steps);
  set("stat-held", stats.held);
  set("stat-checks", stats.checks);
  set("stat-ms", stats.checks ? stats.checkMs / stats.checks : 0);
  set("stat-placeholders", stats.placeholders);
  set("stat-asked", stats.asked);
  set("stat-yes", stats.yes);
  set("stat-no", stats.no);
}

// ---------------------------------------------------------------- wiring view

const WIRES = [
  // [selector, label, who]
  ["ui-tabs", "<ui-tabs>", "ui"],
  ["ui-textarea", "<ui-textarea>", "ui"],
  ["ui-input", "<ui-input>", "ui"],
  ["ui-switch", "<ui-switch>", "ui"],
  ["ui-select", "<ui-select>", "ui"],
  ["ui-button", "<ui-button> · agent may press", "ui"],
  ["ui-file-input", "<ui-file-input>", "ui"],
  ["#allowance", "data-agent-confirm → deliverdAllow()", "deliverd"],
  ["#verdict", "Deliverd Screen · screen()", "deliverd"],
  ["#preview", "Deliverd Screen · placeholders", "deliverd"],
  ["#phone", "Deliverd approvals", "deliverd"],
  ["#result", "Server re-check · Deliverd Screen", "deliverd"],
  [".agent", "createAgent() · UI SDK agent bridge", "ui"],
  ["#history-report", "Deliverd Screen · scanHistory()", "deliverd"],
  [".history .drop", "<ui-file-input>", "ui"],
];

let layer = null;
let raf = 0;

export function setWiring(on) {
  document.body.classList.toggle("wiring", on);
  cancelAnimationFrame(raf);
  if (!on) {
    layer?.remove();
    layer = null;
    return;
  }
  layer = document.createElement("div");
  layer.className = "wire-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  let last = "";
  const draw = () => {
    const boxes = [];
    const seen = new Set();
    for (const [selector, label, who] of WIRES) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        // Only the outermost component of a kind, not each part inside it.
        if (el.parentElement?.closest(selector)) continue;
        seen.add(el);
        // Some components lay out as their contents; measure what's inside.
        let r = el.getBoundingClientRect();
        if ((r.width < 4 || r.height < 4) && el.firstElementChild) r = el.firstElementChild.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        boxes.push({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, label, who });
      }
    }
    const key = JSON.stringify(boxes);
    if (key !== last) {
      last = key;
      layer.replaceChildren(
        ...boxes.map((b) => {
          const box = document.createElement("div");
          box.className = `wire ${b.who}`;
          box.style.cssText = `left:${b.x - 3}px;top:${b.y - 3}px;width:${b.w + 6}px;height:${b.h + 6}px`;
          const tag = document.createElement("span");
          tag.textContent = b.label;
          box.append(tag);
          return box;
        })
      );
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
}
