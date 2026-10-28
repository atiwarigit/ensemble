// Shared helpers for the scripted demo recordings (not part of the app or test suite).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

export function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

// Captions are tied to the URL they were set on, so they disappear when the page changes.
/** A code with at least 5s left, so it doesn't expire between typing and submitting. */
export async function freshTotp(page, secret) {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 5) await page.waitForTimeout(remaining * 1000 + 300);
  return totp(secret);
}

const CAPTION_SCRIPT = () => {
  const here = () => location.pathname + location.search;
  const render = () => {
    const saved = JSON.parse(sessionStorage.getItem("demo-caption") || "null");
    let el = document.getElementById("demo-caption");
    if (!saved || saved.url !== here()) return el?.remove();
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(17,17,17,.88);color:#fff;font:500 18px/1.4 system-ui,sans-serif;" +
        "padding:10px 18px;border-radius:10px;max-width:80%;text-align:center;pointer-events:none";
      document.documentElement.appendChild(el);
    }
    el.textContent = saved.text;
  };
  window.__demoCaption = (text) => {
    sessionStorage.setItem("demo-caption", JSON.stringify({ text, url: here() }));
    render();
  };
  setInterval(render, 100);
};

export async function startDemo(baseURL) {
  const videoDir = path.join("/tmp/demo-video", String(Date.now()));
  mkdirSync(videoDir, { recursive: true });
  const browser = await chromium.launch({ slowMo: 250 });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(CAPTION_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const caption = async (text, holdMs = 1800) => {
    await page.evaluate((t) => window.__demoCaption(t), text);
    await page.waitForTimeout(holdMs);
  };
  const pause = (ms = 1500) => page.waitForTimeout(ms);
  const scroll = async (dy) => {
    await page.mouse.move(760, 420);
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(600);
  };

  const finish = async (outFile) => {
    await pause(1500);
    await context.close();
    await browser.close();
    const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
    mkdirSync(path.dirname(outFile), { recursive: true });
    // Encode locally, then copy: some mounts (e.g. the agent store) reject renames over an existing file.
    const tmp = path.join(videoDir, "out.mp4");
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y", "-i", path.join(videoDir, webm),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "26", "-movflags", "+faststart", tmp,
    ]);
    rmSync(outFile, { force: true });
    copyFileSync(tmp, outFile);
    rmSync(videoDir, { recursive: true, force: true });
  };

  return { page, caption, pause, scroll, finish };
}

export async function signIn(page, email, password, secret) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (secret) {
    await page.getByLabel("Authentication code").waitFor();
    await page.getByLabel("Authentication code").fill(await freshTotp(page, secret));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}
