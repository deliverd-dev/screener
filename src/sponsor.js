// Ghost.exe, Screener's sponsor, drawn as crisp SVG from its text sprite.
import { ghost } from "./ghost.js";

/** An <svg> of Ghost.exe in one pose. `size` is in CSS pixels. */
export function ghostSvg(frame = "idle", size = 64, title = "") {
  const rows = ghost.frames[frame] ?? ghost.frames.idle;
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === ".") { x++; continue; }
      let end = x;
      while (end < row.length && row[end] === c) end++;
      const fill = ghost.palette[c];
      if (fill) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`);
      x = end;
    }
  });
  const label = title ? `<title>${escapeHtml(title)}</title>` : "";
  return `<svg class="ghost" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" role="${title ? "img" : "presentation"}"${title ? ` aria-label="${escapeHtml(title)}"` : ' aria-hidden="true"'}>${label}${rects.join("")}</svg>`;
}

export const CATEGORY_NAMES = {
  personal: "Personal data",
  financial: "Money and bank details",
  secret: "Secrets and keys",
  special: "Special-category data",
  confidential: "Your confidential words",
};

/** One line on what Screener will do, for the status under the title. */
export function statusLine(verdict, { replaced = 0 } = {}) {
  switch (verdict) {
    case "allow":
      return "Nothing found that the model may not receive.";
    case "redact":
      return `${replaced === 1 ? "One value goes" : `${replaced || "Some"} values go`} out as placeholders, and the real ones come back in the answer.`;
    case "ask":
      return "This one needs a person's yes before it goes.";
    case "deny":
      return "Secrets are never sent.";
    default:
      return "Paste a prompt or drop a file. It's checked here, in this tab.";
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
