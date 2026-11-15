type Result = { id: number; data?: ArrayBuffer; error?: string; regional?: boolean; regionalMissing?: boolean };
const pending = new Map<number, (message: Result) => void>();
let worker: Worker | undefined;
let serial = 0;

export function browserHeightTile(level: number, x: number, y: number) {
  if (!worker) {
    worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<Result>) => pending.get(data.id)?.(data);
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      for (const [id, finish] of pending) finish({ id, error: "Lunar terrain worker stopped." });
    };
  }
  const active = worker, id = ++serial;
  return new Promise<{ data: ArrayBuffer; regional: boolean; regionalMissing: boolean }>((resolve, reject) => {
    pending.set(id, ({ data, error, regional, regionalMissing }) => {
      pending.delete(id);
      if (data) resolve({ data, regional: Boolean(regional), regionalMissing: Boolean(regionalMissing) });
      else reject(new Error(error || "Lunar terrain is unavailable."));
    });
    active.postMessage({ level, x, y, id });
  });
}
