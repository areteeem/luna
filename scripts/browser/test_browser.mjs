/* Compare Vite's served browser workers to outputs from local SPICE/LOLA. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const playwright = process.env.LUNA_PLAYWRIGHT
  ? pathToFileURL(path.resolve(process.env.LUNA_PLAYWRIGHT)).href : "playwright";
const { chromium } = await import(playwright);
const browser = await chromium.launch({ executablePath: process.env.LUNA_CHROMIUM, headless: true });
const target = process.argv[2] || "http://127.0.0.1:4181";
const origin = new URL(target).origin;
const fixtures = JSON.parse(await readFile(new URL("../../work/browser-parity.json", import.meta.url)));

function compare(actual, expected, key, tolerance = 1e-6) {
  if (typeof expected === "number") {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(tolerance, Math.abs(expected) * 1e-10),
      `${key}: ${actual} vs ${expected}`);
  } else if (expected && typeof expected === "object") {
    if (Array.isArray(expected)) assert.equal(actual?.length, expected.length, key);
    for (const [k, v] of Object.entries(expected)) compare(actual?.[k], v, `${key}.${k}`, tolerance);
  } else assert.equal(actual, expected, key);
}

try {
  const page = await browser.newPage();
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (token) await page.route(url => url.origin === origin, async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token }, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await page.goto(origin + "/navigator.html");
  await page.evaluate(async () => {
    const shell = await (await fetch("/luna-shell.json")).json();
    const workers = Object.fromEntries(["science", "terrain"].map(kind => {
      const url = shell.files.find(file => file.startsWith("/assets/" + kind + ".worker-"));
      if (!url) throw new Error("Missing worker: " + kind);
      return [kind, new Worker(url, { type: "module" })];
    }));
    let id = 0;
    window.submitWorker = (kind, input) => new Promise((resolve, reject) => {
      const worker = workers[kind];
      const current = ++id;
      const timer = setTimeout(() => finish(new Error("Browser worker timed out")), 160000);
      const exit = ({ data }) => {
        if (data.id !== current) return;
        if (data.error) finish(new Error(data.error));
        else finish(null, data.json ? JSON.parse(data.json) :
          { max: new DataView(data.data).getUint32(0, true), heights: Array.from(new Float32Array(data.data, 4)), regional: data.regional,
            regionalMissing: data.regionalMissing });
      };
      const fail = (e) => finish(new Error(e.message || "Worker script failed"));
      function finish(error, value) {
        clearTimeout(timer); worker.removeEventListener("message", exit); worker.removeEventListener("error", fail);
        if (error) reject(error); else resolve(value);
      }
      worker.addEventListener("message", exit); worker.addEventListener("error", fail);
      worker.postMessage({ id: current, ...input });
    });
  });
  const heights = [];
  for (const { expected, ...tile } of fixtures.tiles) {
    const actual = await page.evaluate(input => window.submitWorker("terrain", input), tile);
    const bytes = Buffer.from(expected, "base64");
    const native = Array.from({ length: 65 ** 2 }, (_, i) => bytes.readFloatLE(4 + i * 4));
    assert.equal(actual.regionalMissing, false, JSON.stringify(tile));
    assert.equal(actual.max, bytes.readUInt32LE(0), JSON.stringify(tile));
    compare(actual.heights, native, JSON.stringify(tile), .005);
    heights.push(actual.heights);
    console.log("Terrain parity:", tile, actual.regional ? "regional" : "global");
  }
  for (let row = 0; row < 65; row++) assert.equal(heights[1][65 * row + 64], heights[2][65 * row]);
  for (const { label, kind, expected, payload } of fixtures.jobs) {
    const started = Date.now();
    const actual = await page.evaluate(input => window.submitWorker("science", input), { kind, body: JSON.stringify(payload) });
    assert.ok(!actual.error, actual.error);
    if (kind === "routes") {
      assert.equal(actual.status, expected.status);
      assert.equal(actual.status, "ok");
      compare(actual.order, expected.order, label);
      compare(actual.legs.map(leg => ({ source: leg.source, path: leg.path })),
        expected.legs.map(leg => ({ source: leg.source, path: leg.path })), label);
    } else if (kind === "recommendations") {
      const searched = Date.parse(actual.searched_from);
      assert.ok(searched >= started - 1000 && searched <= Date.now());
      const { searched_from: _nativeTime, ...native } = expected;
      compare(actual, native, label);
    } else compare(actual, expected, label);
    console.log("Science parity:", label);
  }
} finally { await browser.close(); }
