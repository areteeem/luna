export type Dataset = {
  file: string; url: string; sha256: string; bytes: number; category: string; chunks: string[];
};
export type BrowserManifest = {
  datasets: Record<string, Dataset>;
  models: Record<string, string>;
  pyodide: string;
  py_files: string[];
  packages: Record<string, string>;
  kernels: unknown[];
  science: unknown;
};

let pending: Promise<BrowserManifest> | undefined;
export function browserManifest() {
  pending ??= fetch("/browser-science.json", { cache: "no-cache" }).then(async (r) => {
    if (!r.ok || !r.headers.get("content-type")?.includes("json")) throw new Error("Browser science data are unavailable. Reconnect or download a science pack.");
    return await r.json() as BrowserManifest;
  }).catch((error) => { pending = undefined; throw error; });
  return pending;
}

export async function getAsset(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load LUNA data: ${path.split("/").at(-1)}`);
  return new Uint8Array(await response.arrayBuffer());
}

export const assetChunkSize = 8 * 1024 * 1024;
export async function getDataset(dataset: Dataset) {
  const bytes = new Uint8Array(dataset.bytes);
  for (let i = 0; i < dataset.chunks.length; i += 4) {
    const chunks = await Promise.all(dataset.chunks.slice(i, i + 4).map(getAsset));
    chunks.forEach((chunk, j) => {
      const offset = (i + j) * assetChunkSize;
      if (chunk.length !== Math.min(assetChunkSize, dataset.bytes - offset)) throw new Error("Unexpected science data size.");
      bytes.set(chunk, offset);
    });
  }
  return bytes;
}
