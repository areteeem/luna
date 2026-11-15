import { browserTiff } from "./browserTiff";
import { browserManifest, getDataset } from "./browserData";

const radius = 1737400, size = 65, width = 5760, height = 2880, rad = Math.PI / 180;
const globalLevel = 6;
const nativeLevel = (meters: number) => Math.min(14, Math.max(globalLevel, Math.ceil(Math.log2(180 * 30323 / (64 * meters)))));

type Sample = { column: number; row: number; i: number };
type Tile = { id: number; level: number; x: number; y: number };
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const bilinear = (a: number, b: number, c: number, d: number, x: number, y: number) =>
  lerp(lerp(a, b, x), lerp(c, d, x), y);

let globalData: ReturnType<typeof loadGlobal> | undefined;
async function loadGlobal() {
  const manifest = await browserManifest();
  const bytes = await getDataset(manifest.datasets["ldem_16.img"]);
  const grid = new Int16Array(bytes.buffer);
  const pole = (row: number) => grid.subarray(row * width, (row + 1) * width).reduce((sum, h) => sum + h, 0) / width / 2;
  return { grid, north: pole(0), south: pole(height - 1) };
}
type Global = Awaited<ReturnType<typeof loadGlobal>>;
function globalHeight({ grid, north, south }: Global, lon: number, lat: number) {
  if (lat >= 90 - 1e-12) return north;
  if (lat <= -90 + 1e-12) return south;
  const col = ((lon % 360 + 360) % 360) * 16 - 0.5;
  const row = clamp((90 - lat) * 16 - 0.5, 0, height - 1);
  const c = Math.floor(col), r = Math.floor(row);
  const x = (c + width) % width, x2 = (x + 1) % width;
  const a = r * width, b = Math.min(r + 1, height - 1) * width;
  return 0.5 * bilinear(grid[a + x], grid[a + x2], grid[b + x], grid[b + x2], col - c, row - r);
}
const regions = new Map<string, ReturnType<typeof loadRegion>>();
async function loadRegion(name: string) {
  const record = (await browserManifest()).datasets[name];
  const image = await browserTiff(record);
  const [x, y] = image.getOrigin(), [dx, dy] = image.getResolution();
  return { image, x, y, dx, dy, nodata: image.getGDALNoData() };
}
function region(name: string) {
  let pending = regions.get(name);
  if (!pending) {
    pending = loadRegion(name).catch((err) => { regions.delete(name); throw err; });
    regions.set(name, pending);
  }
  return pending;
}

async function overlay(name: string, coords: { x: number; y: number; i: number }[], heights: Float32Array) {
  const { image, x, y, dx, dy, nodata } = await region(name);
  const w = image.getWidth(), h = image.getHeight(), blockSize = 512;
  const blocks = new Map<number, Sample[]>();
  for (const coord of coords) {
    const column = (coord.x - x) / dx - 0.5, row = (coord.y - y) / dy - 0.5;
    if (column < 0 || column >= w - 1 || row < 0 || row >= h - 1) continue;
    const key = Math.floor(row / blockSize) * Math.ceil(w / blockSize) + Math.floor(column / blockSize);
    const samples = blocks.get(key) || [];
    samples.push({ column, row, i: coord.i });
    blocks.set(key, samples);
  }
  let used = false;
  for (const samples of blocks.values()) {
    let c = w, r = h, right = 0, bottom = 0;
    for (const { column, row } of samples) {
      const ix = Math.floor(column), iy = Math.floor(row);
      c = Math.min(c, ix); r = Math.min(r, iy);
      right = Math.max(right, ix + 2); bottom = Math.max(bottom, iy + 2);
    }
    const pixels = await image.readRasters({ window: [c, r, right, bottom], interleave: true, samples: [0] });
    const pitch = right - c;
    for (const { column, row, i } of samples) {
      const cx = Math.floor(column), ry = Math.floor(row);
      const p = (ry - r) * pitch + cx - c;
      const a = pixels[p], b = pixels[p + 1], d = pixels[p + pitch], e = pixels[p + pitch + 1];
      if (![a, b, d, e].every((value) => Number.isFinite(value) && value !== nodata)) continue;
      heights[i] = bilinear(a, b, d, e, column - cx, row - ry);
      used = true;
    }
  }
  return used ? Math.abs(dx) : Infinity;
}

async function tile({ x, y, level }: Tile) {
  if (!Number.isInteger(level) || level < 0 || level > 14 ||
      !Number.isInteger(x) || x < 0 || x >= 2 ** (level + 1) ||
      !Number.isInteger(y) || y < 0 || y >= 2 ** level) throw new Error("Invalid terrain tile.");
  globalData ??= loadGlobal().catch((err) => { globalData = undefined; throw err; });
  const planet = await globalData;
  const data = new ArrayBuffer(4 + size * size * 4), heights = new Float32Array(data, 4);
  const step = 180 / (2 ** level * (size - 1));
  const coords: { x: number; y: number; i: number }[] = [];
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const lon = -180 + (x * (size - 1) + column) * step, lat = 90 - (y * (size - 1) + row) * step;
    const i = row * size + column;
    heights[i] = globalHeight(planet, lon, lat);
    if (level >= globalLevel && lat <= -75) {
      const distance = 2 * radius * Math.tan((lat + 90) * rad / 2);
      coords.push({ x: distance * Math.sin(lon * rad), y: distance * Math.cos(lon * rad), i });
    }
  }
  let finest = Infinity, regionalMissing = false;
  if (coords.length) {
    for (const name of ["lola80s.tif", "site04.tif"]) {
      try { finest = Math.min(finest, await overlay(name, coords, heights)); }
      catch { regionalMissing = true; } // The independently sourced global grid stays usable.
    }
  }
  new DataView(data).setUint32(0, nativeLevel(finest), true);
  return { data, regional: Number.isFinite(finest), regionalMissing };
}

self.onmessage = ({ data: request }: MessageEvent<Tile>) => {
  void tile(request).then(({ data, regional, regionalMissing }) => {
    self.postMessage({ id: request.id, data, regional, regionalMissing }, { transfer: [data] });
  }).catch((error) => self.postMessage({ id: request.id, error: String(error) }));
};
