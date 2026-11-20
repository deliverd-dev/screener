// Ghost.exe, Screener's sponsor, loose on the page.
//
// Pure decoration: it floats over everything, says what just happened in a
// speech bubble, and flies to whatever the page is talking about. It never
// blocks a click (only the ghost itself takes the pointer), it's hidden from
// screen readers (the status line already says the same), and with reduced
// motion it stays put and only changes face.
import { ghostSvg } from "./sponsor.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const QUIPS = [
  "Boo. I'm the sponsor.",
  "I checked every prompt. I saw nothing. Probably.",
  "Placeholders are just values in a sheet.",
  "I don't do secrets. I keep them in the house.",
  "Ask a person. They have a pulse.",
  "Built with Vercel UI SDK. I can't use buttons; agents can.",
  "Deliverd asked me who said yes. It was you.",
];

export function createGhost({ enabled = true } = {}) {
  const actor = document.createElement("div");
  actor.className = "ghost-actor";
  actor.setAttribute("aria-hidden", "true");
  actor.innerHTML = `<div class="ghost-bob"><div class="ghost-body"></div></div><div class="ghost-say" hidden></div>`;
  document.body.append(actor);
  const body = actor.querySelector(".ghost-body");
  const bubble = actor.querySelector(".ghost-say");

  let on = enabled;
  let frame = "idle";
  let pos = home();
  let flight = null;
  let sayTimer = 0;
  let faceTimer = 0;
  let idleTimer = 0;
  let busyUntil = 0;
  let quip = 0;

  actor.hidden = !on;
  draw("idle");
  place(pos);

  function size() {
    return innerWidth < 640 ? 48 : 72;
  }
  function home() {
    const s = size();
    return { x: innerWidth - s - (innerWidth < 640 ? 12 : 28), y: innerHeight - s - (innerWidth < 640 ? 14 : 28) };
  }
  function draw(name) {
    frame = name;
    body.innerHTML = ghostSvg(name, size());
  }
  function face(name, ms = 1600) {
    draw(name);
    clearTimeout(faceTimer);
    if (ms) faceTimer = setTimeout(() => draw("idle"), ms);
  }
  function place(p) {
    pos = p;
    actor.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    actor.classList.toggle("bubble-left", p.x > innerWidth / 2);
    actor.classList.toggle("bubble-below", p.y < 110);
  }

  /** Fly to a point (viewport coordinates) along a wavy path. */
  function flyTo(target, { ms = 900, wave = 40, loops = 0 } = {}) {
    if (!on) return Promise.resolve();
    flight?.cancel();
    const from = { ...pos };
    if (reduced()) {
      place(target);
      return Promise.resolve();
    }
    const frames = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      let x = from.x + (target.x - from.x) * e;
      let y = from.y + (target.y - from.y) * e + Math.sin(t * Math.PI * 2) * wave * (1 - t);
      let r = Math.sin(t * Math.PI * 2) * 10;
      if (loops) {
        const a = t * Math.PI * 2 * loops;
        x += Math.sin(a) * 50 * Math.sin(t * Math.PI);
        y += (Math.cos(a) - 1) * 50 * Math.sin(t * Math.PI);
        r = t * 360 * loops;
      }
      frames.push({ transform: `translate(${x}px, ${y}px) rotate(${r}deg)` });
    }
    flight = actor.animate(frames, { duration: ms, easing: "linear" });
    place(target);
    const done = flight.finished.catch(() => {});
    return done;
  }

  /** Fly next to an element: beside its top right corner, kept on screen. */
  function visit(el, opts) {
    if (!el || !on) return Promise.resolve();
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return Promise.resolve();
    const s = size();
    const x = Math.min(innerWidth - s - 8, Math.max(8, r.right - s * 0.6));
    const y = Math.min(innerHeight - s - 8, Math.max(8, r.top - s * 0.55));
    return flyTo({ x, y }, opts);
  }

  function say(text, ms = 3200) {
    if (!on) return;
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => (bubble.hidden = true), ms);
  }

  function bounce(times = 2) {
    if (!on || reduced()) return;
    actor.querySelector(".ghost-bob").animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-22px) scaleY(1.06)" }, { transform: "translateY(0) scaleY(.92)" }, { transform: "translateY(0)" }],
      { duration: 420, iterations: times, easing: "cubic-bezier(.3,.7,.4,1)" }
    );
  }
  function shake() {
    if (!on || reduced()) return;
    actor.querySelector(".ghost-bob").animate(
      [0, -8, 8, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 480 }
    );
  }
  function sparkle(count = 14) {
    if (!on || reduced()) return;
    const s = size();
    const cx = pos.x + s / 2;
    const cy = pos.y + s / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "spark";
      p.setAttribute("aria-hidden", "true");
      p.textContent = ["✦", "✧", "·", "★"][i % 4];
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.color = ["var(--accent)", "var(--ok)", "var(--personal)", "var(--warn)"][i % 4];
      document.body.append(p);
      const a = (i / count) * Math.PI * 2;
      const d = 50 + Math.random() * 60;
      p.animate(
        [
          { transform: "translate(-50%,-50%) scale(.4)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1.2)`, opacity: 0 },
        ],
        { duration: 700 + Math.random() * 400, easing: "cubic-bezier(.2,.8,.3,1)" }
      ).finished.then(() => p.remove());
    }
  }

  /** Swoop across the whole screen and back home. */
  async function flyThrough() {
    if (!on || reduced() || Date.now() < busyUntil) return;
    const s = size();
    const y = innerHeight * (0.25 + Math.random() * 0.4);
    flight?.cancel();
    place({ x: -s - 20, y });
    await flyTo({ x: innerWidth + 20, y: y - 60 }, { ms: 2600, wave: 70 });
    place({ x: innerWidth + 20, y: home().y });
    await flyTo(home(), { ms: 700, wave: 10 });
  }

  /** React to what just happened on the page. */
  async function react(kind, detail = {}) {
    if (!on) return;
    busyUntil = Date.now() + 6000;
    resetIdle();
    switch (kind) {
      case "allow":
        face("happy");
        await visit(detail.el, { ms: 700 });
        bounce(2);
        say("Clean as a fresh sheet.");
        break;
      case "redact":
        face("happy");
        await visit(detail.el, { ms: 800 });
        bounce(1);
        say(detail.n === 1 ? "One value swapped for a placeholder. Nom." : `${detail.n} values swapped for placeholders. Nom nom.`);
        break;
      case "ask":
        face("shock", 2400);
        await visit(detail.el, { ms: 800 });
        shake();
        say("Ooh. A person should see this first.");
        break;
      case "deny":
        face("shock", 2600);
        await visit(detail.el, { ms: 600 });
        shake();
        say("A secret! It's not leaving the house.");
        break;
      case "waiting":
        face("shock", 2000);
        await visit(detail.el, { ms: 800 });
        bounce(3);
        say(detail.text ?? "Your phone's buzzing.");
        break;
      case "sent":
        face("happy", 2600);
        await flyTo({ ...pos }, { ms: 1100, wave: 0, loops: 1 });
        sparkle(18);
        say(detail.text ?? "Delivered. Real values back in the answer.");
        break;
      case "declined":
        face("sleep", 2600);
        await visit(detail.el, { ms: 700 });
        say(detail.text ?? "Fine. Nothing went out.");
        break;
      case "agent-step":
        face("idle", 0);
        await visit(detail.el, { ms: 600, wave: 20 });
        if (detail.text) say(detail.text, 2200);
        break;
      case "agent-held":
        face("shock", 2400);
        await visit(detail.el, { ms: 500, wave: 10 });
        shake();
        say("Hold it! That one's marked. A person decides.");
        break;
      case "history":
        face(detail.found ? "shock" : "happy", 2600);
        await visit(detail.el, { ms: 900 });
        say(detail.found ? "I've seen things. Lots of things." : "Nothing spooky in there.");
        break;
      case "home":
        await flyTo(home(), { ms: 800 });
        break;
    }
  }

  // Idle life: blink, wander home after a while, swoop across now and then.
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      if (!on) return;
      bubble.hidden = true;
      await flyTo(home(), { ms: 900 });
      idleTimer = setTimeout(() => flyThrough().then(resetIdle), 30000 + Math.random() * 20000);
    }, 9000);
  }
  setInterval(() => {
    if (!on || frame !== "idle") return;
    draw("blink");
    setTimeout(() => frame === "blink" && draw("idle"), 160);
  }, 3800);

  // Poke it.
  actor.addEventListener("click", async () => {
    busyUntil = Date.now() + 4000;
    face("happy", 1800);
    say(QUIPS[quip++ % QUIPS.length]);
    if (!reduced()) await flyTo({ ...pos }, { ms: 900, wave: 0, loops: 1 });
    sparkle(10);
    resetIdle();
  });

  addEventListener("resize", () => {
    draw(frame);
    if (!flight || flight.playState !== "running") place(home());
  });

  /** The entrance: in from the top left, past the title, to its corner. */
  async function enter() {
    if (!on) return;
    if (reduced()) {
      say("Boo. Ghost.exe presents: Screener.");
      resetIdle();
      return;
    }
    place({ x: -80, y: 40 });
    const title = document.querySelector("h1");
    face("happy", 2400);
    if (title) await visit(title, { ms: 1300, wave: 50 });
    bounce(2);
    say("Boo. Ghost.exe presents: Screener.");
    await new Promise((r) => setTimeout(r, 1600));
    await flyTo(home(), { ms: 1200, wave: 60 });
    resetIdle();
  }

  function setEnabled(value) {
    on = value;
    actor.hidden = !on;
    if (on) {
      place(home());
      say("I'm back.");
      resetIdle();
    } else {
      clearTimeout(idleTimer);
      flight?.cancel();
    }
  }

  return { react, say, enter, flyThrough, setEnabled, get enabled() { return on; } };
}
