import { browserManifest, getAsset, getDataset } from "./browserData";
import { loadSpice } from "./spiceWasm";

interface Pyodide {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string | Uint8Array, options?: { canOwn: boolean }): void;
  };
  registerJsModule(name: string, module: object): void;
  loadPackage(name: string): Promise<unknown>;
  runPython(code: string): unknown;
  globals: { set(name: string, value: string): void };
}

async function initialize() {
  const manifest = await browserManifest();
  const indexURL = new URL(manifest.pyodide + "/", self.location.origin).href;
  const module = indexURL + "pyodide.mjs";
  const { loadPyodide } = await import(/* @vite-ignore */ module) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
  };
  const [py, spice] = await Promise.all([loadPyodide({ indexURL }), loadSpice()]);
  const files = Promise.all(Object.entries(manifest.models).map(async ([name, path]) => [name, await getAsset(path)] as const));
  const [models] = await Promise.all([files, py.loadPackage("numpy")]);
  py.registerJsModule("luna_spice_js", spice);
  for (const folder of ["/luna/scripts", "/luna/work/kernels", "/luna/work/terrain"]) py.FS.mkdirTree(folder);
  for (const [name, code] of models) py.FS.writeFile(`/luna/scripts/${name}.py`, code);
  py.FS.writeFile("/luna/work/kernels/manifest.json", JSON.stringify(manifest.kernels));
  py.FS.writeFile("/luna/work/science-manifest.json", JSON.stringify(manifest.science));
  py.runPython("import sys; sys.path.insert(0, '/luna/scripts'); import luna_entry");
  return { py, spice, manifest, staged: new Set<string>() };
}
let startup: ReturnType<typeof initialize> | undefined;
let serial = Promise.resolve();
const canceled = new Set<number>();
type Job = {
  id: number; kind: "geometry" | "routes" | "recommendations";
  body: string;
};
function geometryTerrainSources(payload: Record<string, any>) {
  const lat = Number(payload.lat);
  const rangeKm = Number(payload.analysis?.horizon_range_km ?? 250);
  if (!Number.isFinite(lat) || !Number.isFinite(rangeKm)) return [];

  // The browser build currently carries southern polar DEMs only. Avoid
  // downloading and expanding them for geometry sites whose entire horizon
  // range is outside those rasters. The Python model then reports unavailable
  // terrain explicitly; it does not substitute a flat horizon.
  const radiansToKm = 1737.4 * Math.PI / 180;
  const sources: string[] = [];
  const distanceTo80SouthKm = Math.max(0, lat + 80) * radiansToKm;
  if (distanceTo80SouthKm <= rangeKm) sources.push("lola80s.tif");

  // Site04 is a small south polar patch extending about 18 km from the pole.
  // Load it only when the observer's requested horizon can reach that patch.
  const distanceToSouthPoleKm = (90 + lat) * radiansToKm;
  if (distanceToSouthPoleKm <= rangeKm + 18) sources.push("site04.tif");
  return sources;
}
async function run({ id, kind, body }: Job) {
  if (canceled.delete(id)) return;
  try {
    startup ??= initialize().catch((error) => { startup = undefined; throw error; });
    const state = await startup;
    if (canceled.delete(id)) return;
    const { py, spice, manifest, staged } = state;
    const payload = JSON.parse(body);
    const terrain = kind !== "geometry" || Boolean(payload.analysis?.enabled && payload.analysis.terrain !== false);
    const analyzed = kind === "recommendations" || Boolean(payload.analysis?.enabled);
    const wantsLRO = Boolean(payload.satellites?.some((s: { ephemeris?: string }) => s?.ephemeris === "LRO-2022"));
    const policy = new Set<string>();
    if (kind !== "routes") {
      for (const { name } of manifest.kernels as { name: string }[]) policy.add(name);
      if (analyzed) for (const name of Object.keys(manifest.datasets)) {
        if (manifest.datasets[name].category === "analysis" && /\.(bpc|bsp|tf)$/.test(name) && !name.startsWith("lrorg")) policy.add(name);
      }
      if (wantsLRO) policy.add("lrorg_2022258_2022349_v01.bsp");
    }
    if (terrain) {
      const terrainSources = kind === "geometry"
        ? geometryTerrainSources(payload)
        : ["lola80s.tif", "site04.tif"];
      for (const name of terrainSources) policy.add(name);
      if (kind === "routes") policy.add("ldem_16.img");
    }
    for (const name of policy) {
      if (staged.has(name)) continue;
      if (canceled.delete(id)) return;
      const record = manifest.datasets[name];
      const target = "/luna/" + record.file;
      if (name.endsWith(".tif")) {
        const image = await (await import("./browserTiff")).browserTiff(record);
        const raw = await image.readRasters({ interleave: true, samples: [0] });
        if (!(raw instanceof Float32Array)) throw new Error("Unexpected source DEM data type.");
        const [x, y] = image.getOrigin(), [dx, dy] = image.getResolution();
        py.FS.writeFile(target + ".bin", new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), { canOwn: true });
        py.FS.writeFile(target, JSON.stringify({ width: image.getWidth(), height: image.getHeight(), x, y, dx, dy }));
      } else {
        const bytes = await getDataset(record);
        const kernel = record.file.startsWith("work/kernels/");
        if (kernel) spice.stageKernel(name, bytes);
        py.FS.writeFile(target, kernel ? "" : bytes, { canOwn: true });
      }
      staged.add(name);
    }
    if (kind !== "routes") py.runPython("luna_entry.load_kernels()");
    if (canceled.delete(id)) return;
    py.globals.set("luna_operation", kind);
    py.globals.set("luna_payload", body);
    const json = py.runPython("luna_entry.run(luna_operation, luna_payload)");
    postMessage({ id, json });
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = ({ data }: MessageEvent<Job | { cancel: number }>) => {
  if ("cancel" in data) {
    canceled.add(data.cancel);
    // Bound cancellation bookkeeping for jobs that already finished.
    if (canceled.size > 512) canceled.delete(canceled.values().next().value!);
  } else serial = serial.then(() => run(data));
};
