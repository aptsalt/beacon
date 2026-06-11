/** Records a ~95s captioned walkthrough of the live Beacon deployment.
 *  Output: ./video/<hash>.webm → converted to beacon-demo.mp4 by the runner.
 *  Captions mirror the Loom narration script (demo/narration-script.md). */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const URL = "https://beacon-ten-sigma.vercel.app";
mkdirSync("./video", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "./video", size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// Caption bar (Cohere-styled) + visible cursor dot, injected on every page.
await page.addInitScript(() => {
  const ready = () => {
    if (document.getElementById("__cap")) return;
    const cap = document.createElement("div");
    cap.id = "__cap";
    Object.assign(cap.style, {
      position: "fixed", left: "50%", bottom: "88px", transform: "translateX(-50%)",
      maxWidth: "940px", padding: "14px 24px", background: "#062c22", color: "#f0eee9",
      font: "600 17px/1.45 -apple-system, 'Segoe UI', sans-serif", borderRadius: "14px",
      zIndex: 2147483647, boxShadow: "0 8px 30px rgba(6,44,34,.35)", opacity: "0",
      transition: "opacity .35s", pointerEvents: "none", textAlign: "center",
    });
    document.body.appendChild(cap);
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed", width: "16px", height: "16px", borderRadius: "50%",
      background: "#da532c", border: "2.5px solid #fff", boxShadow: "0 1px 6px rgba(0,0,0,.4)",
      zIndex: 2147483647, pointerEvents: "none", left: "-50px", top: "-50px",
      transform: "translate(-50%,-50%)",
    });
    document.body.appendChild(dot);
    window.addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px";
    }, true);
    window.__cap = (t) => { cap.textContent = t; cap.style.opacity = t ? "1" : "0"; };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
});

const cap = (t) => page.evaluate((x) => window.__cap?.(x), t);
const sleep = (ms) => page.waitForTimeout(ms);
const glide = async (locator) => {
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
};

// ── Scene 1 · 0–14s · Home ────────────────────────────────────────────────────
await page.goto(URL, { waitUntil: "networkidle" });
await sleep(800);
await cap("This is Beacon — a working homage to Cohere North, built for the Agentic Platform application.");
await sleep(3500);
await cap("Connected workplace sources — each one a toggle that scopes the agent before retrieval.");
for (const label of ["Company Wiki", "Support Tickets", "Team Calendar"]) {
  await glide(page.locator(`button.conn:has-text("${label}")`));
  await sleep(1100);
}
await sleep(1200);

// ── Scene 2 · 14–42s · Ask → trace → citations ───────────────────────────────
await cap("Watch the agent work: plan → scoped tool calls → answer grounded in retrieved sources.");
const suggestion = page.locator('text=Draft an email to HR');
await glide(suggestion);
await sleep(600);
await suggestion.click();
await page.waitForSelector("mark.cite", { timeout: 20000 });
await sleep(2600);
await cap("Every step is on screen — the plan, each search, and per-step timings.");
await glide(page.locator(".trace"));
await sleep(3600);
await cap("Citations are character offsets the renderer treats as untrusted input — hover one and its source lights up.");
const mark = page.locator("mark.cite").first();
await glide(mark);
await mark.hover();
await sleep(4800);

// ── Scene 3 · 42–62s · Approval + cost footer ────────────────────────────────
await cap("Agents propose. Humans approve. Nothing side-effecting happens without a click.");
const allow = page.locator(".abtns .allow");
await allow.scrollIntoViewIfNeeded();
await glide(allow);
await sleep(2300);
await allow.click();
await page.waitForSelector(".action.executed", { timeout: 10000 });
await sleep(2800);
await cap("Latency and token spend are part of the interface — every run renders its own bill.");
await glide(page.locator(".perf"));
await sleep(4600);

// ── Scene 4 · 62–90s · Span-level feedback ───────────────────────────────────
await cap("Feedback at a granularity you can train on — rate the exact sentence, plan step, or source.");
const fbtoggle = page.locator(".fbtoggle");
await glide(fbtoggle);
await fbtoggle.click();
await page.waitForSelector(".fbrow");
await sleep(1500);
const rows = page.locator(".fbrow");
const pick = async (i, kind) => {
  const btn = rows.nth(i).locator(`.fbr.${kind}`);
  await btn.scrollIntoViewIfNeeded();
  await glide(btn);
  await sleep(700);
  await btn.click();
  await sleep(800);
};
await pick(0, "good");   // plan
await pick(2, "good");   // first answer sentence
await pick(4, "bad");    // off-topic sentence
await cap("Each rating becomes a run-scoped training record — signal tied to the exact step that earned it.");
const comment = page.locator(".fbfoot input");
await comment.scrollIntoViewIfNeeded();
await glide(comment);
await comment.click();
await comment.pressSequentially("The fixed-blocks sentence wasn't relevant to my question.", { delay: 28 });
await sleep(700);
const submit = page.locator(".fbsubmit");
await glide(submit);
await submit.click();
await page.waitForSelector(".fbdone", { timeout: 10000 });
await sleep(3200);

// ── Scene 5 · 90–97s · End card ──────────────────────────────────────────────
await cap("");
await page.goto("https://github.com/aptsalt/beacon", { waitUntil: "domcontentloaded" });
await sleep(1500);
await cap("github.com/aptsalt/beacon  ·  beacon-ten-sigma.vercel.app  ·  zero runtime libraries, 65 KB gzipped");
await sleep(4500);
await cap("");
await sleep(600);

const videoPath = await page.video().path();
await context.close();
await browser.close();
console.log("VIDEO:" + videoPath);
