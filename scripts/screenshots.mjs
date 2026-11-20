// Drives the playground with Playwright and saves the README's screenshots.
//   npm start            (in one terminal)
//   npm run screenshots  (in another; needs `npx playwright install chromium` once)
// Pass an export to also shoot the history tab: npm run screenshots -- path/to/export.zip
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SCREENER_URL ?? "http://127.0.0.1:4173";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const exportFile = process.argv[2];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
const sample = async (label) => {
  await page.getByRole("button", { name: label }).click();
  await page.waitForTimeout(400);
};
const waitForPhone = () => page.waitForSelector("#phone .approve", { timeout: 10_000 });

await page.goto(BASE);
await page.waitForTimeout(600);

await sample("A customer email");
await shot("1-placeholders");

await page.getByRole("button", { name: /Send to/ }).click();
await page.waitForSelector('#result[data-state="sent"]');
await shot("2-sent-and-restored");

await sample("A sick note");
await page.getByRole("button", { name: /Send to/ }).click();
await waitForPhone();
await page.waitForTimeout(300);
await shot("3-needs-a-person");
await page.click("#phone .approve");
await page.waitForSelector('#result[data-state="sent"]');

await sample("A leaked key");
await shot("4-secret-refused");

await page.click("#run-agent");
await waitForPhone();
await page.fill("#phone .note", "Agents don't get to loosen the rules");
await page.click("#phone .decline");
await waitForPhone();
await page.click("#phone .decline");
await page.waitForSelector("#agent-log li:last-child.declined");
await page.waitForTimeout(400);
await shot("5-agent-asked-twice");

if (exportFile) {
  await page.getByRole("tab", { name: "Check your chat history" }).click();
  await page.setInputFiles("#export input[type=file]", exportFile);
  await page.waitForSelector(".report-head");
  await shot("6-chat-history");
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
await phone.goto(BASE);
await phone.waitForTimeout(500);
await phone.getByRole("button", { name: "A customer email" }).click();
await phone.waitForTimeout(400);
await phone.screenshot({ path: `${OUT}7-phone-light.png`, fullPage: true });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

await browser.close();
console.log(`Saved to ${OUT}`);
if (overflow > 0) console.log(`Warning: the phone layout scrolls sideways by ${overflow}px.`);
if (errors.length) {
  console.log("Page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
