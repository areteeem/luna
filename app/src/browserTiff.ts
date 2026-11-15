import { BaseClient, BaseResponse, fromCustomClient } from "geotiff";
import { assetChunkSize } from "./browserData";
import type { Dataset } from "./browserData";

class RangeReply extends BaseResponse {
  private readonly data: Uint8Array<ArrayBuffer>;
  private readonly range: string;
  constructor(data: Uint8Array<ArrayBuffer>, range: string) { super(); this.data = data; this.range = range; }
  override get status() { return 206; }
  override getHeader(name: string) { return name.toLowerCase() === "content-range" ? this.range : undefined; }
  override async getData() { return this.data.buffer; }
}

class ChunkClient extends BaseClient {
  private readonly dataset: Dataset;
  constructor(dataset: Dataset) { super(dataset.chunks[0]); this.dataset = dataset; }
  override async request(options?: RequestInit) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options?.headers).get("range") || "");
    if (!match) throw new Error("Expected a single terrain byte range.");
    const start = Number(match[1]), end = Math.min(this.dataset.bytes - 1, Number(match[2]));
    if (start > end) throw new Error("Invalid terrain byte range.");
    const data = new Uint8Array(end - start + 1);
    const tasks: Promise<void>[] = [];
    for (let i = Math.floor(start / assetChunkSize); i <= Math.floor(end / assetChunkSize); i++) {
      const offset = i * assetChunkSize;
      const lo = Math.max(0, start - offset), hi = Math.min(assetChunkSize - 1, end - offset);
      tasks.push((async () => {
        const r = await fetch(this.dataset.chunks[i], { signal: options?.signal, headers: { Range: `bytes=${lo}-${hi}` } });
        if (!r.ok) throw new Error("Regional terrain data are unavailable.");
        const bytes = new Uint8Array(await r.arrayBuffer());
        const selected = r.status === 206 ? bytes : bytes.subarray(lo, hi + 1);
        if (selected.byteLength !== hi - lo + 1) throw new Error("Regional terrain data are incomplete.");
        data.set(selected, offset + lo - start);
      })());
    }
    await Promise.all(tasks);
    return new RangeReply(data, `bytes ${start}-${end}/${this.dataset.bytes}`);
  }
}

export async function browserTiff(record: Dataset) {
  const options = { maxRanges: 0, blockSize: 128 * 1024, cacheSize: 120 };
  const tiff = await fromCustomClient(new ChunkClient(record), options);
  return tiff.getImage();
}
