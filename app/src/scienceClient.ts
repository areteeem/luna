import { sciencePackReady } from "./browserPacks";
import { hosted } from "./runtime";

type ScienceEndpoint = "/api/geometry" | "/api/recommendations" | "/api/routes";
type Result = { id: number; error?: string; json?: string };
let worker: Worker | undefined, serial = 0;
const pending = new Map<number, (result: Result) => void>();

function scienceWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./science.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<Result>) => pending.get(data.id)?.(data);
  worker.onerror = () => {
    worker?.terminate();
    worker = undefined;
    for (const [id, reject] of pending) reject({ id, error: "The browser science worker stopped. Retry or use the installed editor." });
  };
  return worker;
}

/** The hosted worker and local installer share the Python science and result contracts. */
export async function scienceRequest(endpoint: ScienceEndpoint, init: RequestInit) {
  if (!hosted) return fetch(endpoint, init);
  if (!navigator.onLine) {
    const ready = await sciencePackReady().catch(() => false);
    if (!ready) return Response.json({ error: "New calculations offline need a complete science pack. Reconnect to download it in Offline maps." }, { status: 503 });
  }
  const id = ++serial;
  return new Promise<Response>((resolve, reject) => {
    const active = scienceWorker();
    const signal = init.signal;
    const abort = () => {
      pending.delete(id);
      active.postMessage({ cancel: id });
      reject(signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, ({ error, json }) => {
      signal?.removeEventListener("abort", abort);
      pending.delete(id);
      if (error || !json) {
        resolve(Response.json({ error: error?.split("\n").filter(Boolean).at(-1)?.slice(0, 320) || "Browser science unavailable." }, { status: 503 }));
      } else {
        resolve(new Response(json, { status: JSON.parse(json).error ? 400 : 200, headers: { "Content-Type": "application/json" } }));
      }
    });
    active.postMessage({ id, kind: endpoint.slice(5), body: init.body });
  });
}
