import { browserManifest } from "./browserData";
import { moonLayers, moonTileUrl } from "./moonTiles";
import type { MoonLayer } from "./moonTiles";

const tileCache = "luna-offline-tiles-v1";
const filesCache = "luna-offline-files-v1";
const maxTiles = 4096;
const key = "luna-packs-v1";
type Status = "running" | "complete" | "paused" | "incomplete";
export type Pack = {
  id: string; label: string; kind: "tiles" | "science";
  urls: string[]; status: Status; done: number; bytes: number; detail?: string;
};

let db: Promise<IDBDatabase> | undefined;
function open() {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(key, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  }).catch((error) => { db = undefined; throw error; });
  return db;
}

async function query<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await open()).transaction("packs", mode);
  return new Promise<T>((resolve, reject) => {
    const request = operation(store.objectStore("packs"));
    store.oncomplete = () => resolve(request.result);
    store.onabort = () => reject(store.error || new Error("Browser storage transaction interrupted."));
    store.onerror = () => reject(store.error || new Error("Browser storage unavailable."));
  });
}

export function listPacks() {
  return query<Pack[]>("readonly", (store) => store.getAll());
}
function save(pack: Pack) {
  return query("readwrite", (store) => store.put(pack));
}

export function tilePack(layer: MoonLayer, level: number, lat: number, lon: number, km: number): Pack {
  if (!Number.isInteger(level) || level < 0 || level > moonLayers[layer].max ||
      !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || !Number.isFinite(km) || km <= 0 || km > 100) {
    throw new Error("Select a valid layer, level, and radius up to 100 km.");
  }
  const dlat = km / 1737.4 * 180 / Math.PI;
  const dlon = Math.min(180, dlat / Math.max(0.0001, Math.cos((lat * Math.PI) / 180)));
  const polar = lat + dlat >= 90 || lat - dlat <= -90 || dlon >= 180;
  const mid = (lon % 360 + 540) % 360 - 180;
  const west = mid - dlon, east = mid + dlon;
  const ranges = polar ? [[-180, 180]] : west < -180 ? [[west + 360, 180], [-180, east]] :
    east > 180 ? [[west, 180], [-180, east - 360]] : [[west, east]];
  const north = Math.min(90, lat + dlat), south = Math.max(-90, lat - dlat);
  const urls = new Set<string>();
  // Store ancestors so Cesium can open the globe and reach the selected detail.
  for (let z = 0; z <= level; z++) {
    const rows = 2 ** z, columns = rows * 2;
    const y = (lat: number) => Math.min(rows - 1, Math.floor((90 - lat) / 180 * rows));
    const x = (lon: number) => Math.min(columns - 1, Math.floor((lon + 180) / 360 * columns));
    for (const [a, b] of z === 0 ? [[-180, 180]] : ranges) {
      for (let row = y(north); row <= y(south); row++) for (let col = x(a); col <= x(b); col++) {
        urls.add(moonTileUrl(layer, true, z, row, col));
        if (urls.size > maxTiles) throw new Error("This pack is too large. Reduce the radius or detail level.");
      }
    }
  }
  return { id: crypto.randomUUID(), label: `${layer} · L${level} · ${km} km · ${lat.toFixed(3)}°, ${mid.toFixed(3)}°`,
    kind: "tiles", urls: [...urls], status: "paused", done: 0, bytes: 0 };
}

async function shellAssets() {
  const response = await fetch("/luna-shell.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("The offline app shell is unavailable.");
  const { files } = await response.json() as { files: string[] };
  return files;
}

export async function sciencePack(): Promise<Pack> {
  const manifest = await browserManifest();
  const urls = ["/browser-science.json", "/browser-spice/spice.mjs", "/browser-spice/spice.wasm",
    ...manifest.py_files, ...Object.values(manifest.packages), ...Object.values(manifest.models),
    ...Object.values(manifest.datasets).flatMap((data) => data.chunks)];
  return { id: "science", label: "Offline science · geometry, terrain and routes", kind: "science",
    urls: [...new Set(urls)], status: "paused", done: 0, bytes: 0 };
}

export async function browserStorage() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const remaining = estimate?.quota !== undefined ? Math.max(0, estimate.quota - (estimate.usage ?? 0)) : undefined;
  return { remaining };
}

async function put(cache: Cache, url: string, signal: AbortSignal, image: boolean, refresh = false) {
  const old = refresh ? undefined : await cache.match(url);
  if (old) return Number(old.headers.get("x-luna-bytes")) || 0;
  const response = await fetch(url, { signal, cache: refresh ? "no-cache" : "default", credentials: "same-origin" });
  if (!response.ok || (image && !/^image\/(jpeg|png)/.test(response.headers.get("content-type") || "")))
    throw new Error("Could not download " + new URL(url, location.origin).pathname.split("/").at(-1));
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.set("content-length", String(body.size));
  headers.set("x-luna-bytes", String(body.size));
  await cache.put(url, new Response(body, { headers }));
  return body.size;
}

const running = new Set<string>();
async function withPackLock<T>(name: string, operation: () => Promise<T>) {
  if (navigator.locks) return navigator.locks.request("luna-pack-" + name, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("This pack is in use in another LUNA tab.");
    return operation();
  });
  if (running.has(name)) throw new Error("This pack operation is already running.");
  running.add(name);
  try { return await operation(); } finally { running.delete(name); }
}

export async function downloadPack(pack: Pack, signal: AbortSignal, update: () => void) {
  return withPackLock("all", async () => {
    if (!("serviceWorker" in navigator) || !("caches" in window) || !("indexedDB" in window))
      throw new Error("This browser does not offer offline storage here.");
    await navigator.serviceWorker.register("/luna-offline.js");
    await navigator.serviceWorker.ready;
    // Persistence is a request to the browser; browser storage remains revocable.
    await navigator.storage?.persist?.().catch(() => false);
    const { remaining } = await browserStorage();
    if (remaining !== undefined && remaining < 8 * 1024 ** 2) throw new Error("Free browser storage before downloading.");
    pack = { ...pack, status: "running", done: 0, bytes: 0, detail: undefined };
    await save(pack);
    update();
    try {
      const files = await caches.open(filesCache);
      for (const path of await shellAssets()) await put(files, path, signal, false, !path.startsWith("/assets/"));
      const cache = pack.kind === "tiles" ? await caches.open(tileCache) : files;
      let missed = 0, quota = false;
      for (let i = 0; i < pack.urls.length && !signal.aborted && !quota; i += 4) {
        const batch = await Promise.allSettled(pack.urls.slice(i, i + 4).map(async (url) => {
          const bytes = await put(cache, url, signal, pack.kind === "tiles", url === "/browser-science.json");
          pack.done++;
          pack.bytes += bytes;
        }));
        for (const result of batch) if (result.status === "rejected") {
          missed++;
          quota ||= result.reason instanceof DOMException && result.reason.name === "QuotaExceededError";
        }
        await save(pack);
        update();
      }
      pack = { ...pack, status: signal.aborted ? "paused" : missed || quota ? "incomplete" : "complete",
        detail: quota ? "Browser storage is full." : missed && !signal.aborted ? `${missed} requests failed. Resume to download missing files.` : undefined };
    } catch (error) {
      pack = { ...pack, status: signal.aborted ? "paused" : "incomplete", detail: signal.aborted ? undefined : String(error) };
    }
    await save(pack);
    update();
  });
}

export async function deletePack(id: string) {
  return withPackLock("all", async () => {
    const packs = await listPacks();
    const pack = packs.find((p) => p.id === id);
    if (!pack) return;
    const shared = new Set(packs.filter((p) => p.id !== id && p.kind === pack.kind).flatMap((p) => p.urls));
    const cache = await caches.open(pack.kind === "tiles" ? tileCache : filesCache);
    for (const url of pack.urls) if (!shared.has(url)) await cache.delete(url);
    await query("readwrite", (store) => store.delete(id));
  });
}

export async function sciencePackReady() {
  const pack = (await listPacks()).find((record) => record.id === "science" && record.status === "complete");
  if (!pack) return false;
  const cache = await caches.open(filesCache);
  return (await Promise.all(pack.urls.map((url) => cache.match(url)))).every(Boolean);
}
