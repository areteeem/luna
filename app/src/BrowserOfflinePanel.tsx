import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { activeSite } from "./study";
import { moonLayers } from "./moonTiles";
import type { MoonLayer } from "./moonTiles";
import { browserStorage, deletePack, downloadPack, listPacks, sciencePack, tilePack } from "./browserPacks";
import type { Pack } from "./browserPacks";

export default function BrowserOfflinePanel() {
  const { study } = useWorkspace();
  const site = activeSite(study);
  const [layer, setLayer] = useState<MoonLayer>("imagery");
  const [level, setLevel] = useState(8), [radius, setRadius] = useState(20);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [remaining, setRemaining] = useState<number>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function refresh() {
    const [data, { remaining }] = await Promise.all([listPacks(), browserStorage()]);
    setPacks(data); setRemaining(remaining);
  }
  useEffect(() => { void refresh().catch((e) => setError(String(e))); }, []);
  const run = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError("");
    try {
      await action(request.signal);
      await refresh();
    } catch (err) { setError(String(err)); }
    finally { controller.current = null; setBusy(false); }
  };
  const update = () => { void refresh().catch((e) => setError(String(e))); };
  return <>
    <h2>Offline maps</h2>
    <p>Save a region around the active site to this browser. Pan outside the saved area or switch layers and some imagery may be missing when disconnected.</p>
    {remaining !== undefined && <p className="hint">Estimated browser storage available: {(remaining / 1e9).toFixed(2)} GB.</p>}
    <label className="field">Layer <select value={layer} onChange={(e) => {
      const next = e.target.value as MoonLayer; setLayer(next); setLevel(moonLayers[next].max);
    }}>{Object.keys(moonLayers).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    <label className="field">Detail level <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
      {Array.from({ length: moonLayers[layer].max + 1 }, (_, i) => <option key={i}>{i}</option>)}
    </select></label>
    <label className="field">Radius (km) <input type="number" min="1" max="100" value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></label>
    <button type="button" className="primary" disabled={busy} onClick={() => void run((signal) =>
      downloadPack(tilePack(layer, level, site.lat, site.lon, radius), signal, update))}>Download map region</button>
    <h3>Offline science</h3>
    <p>Download the calculation engine, kernels, and terrain for new calculations while disconnected (about 390 MB). Saved map imagery is separate.</p>
    {!packs.some((pack) => pack.kind === "science") && <button type="button" disabled={busy} onClick={() => void run(async (signal) =>
      downloadPack(await sciencePack(), signal, update))}>Download science data</button>}
    {busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel download</button>}
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite">
      {packs.map((pack) => <section key={pack.id} className="section">
        <strong>{pack.label}</strong>
        <p>{pack.status === "running" && !busy ? "Interrupted or running in another tab" : pack.status} · {pack.done}/{pack.urls.length} files · {(pack.bytes / 1e6).toFixed(1)} MB</p>
        {pack.detail && <p>{pack.detail}</p>}
        {pack.status !== "complete" && <button type="button" disabled={busy} onClick={() => void run((signal) =>
          downloadPack(pack, signal, update))}>Resume missing files</button>}
        <button type="button" disabled={busy} onClick={() => void run(() => deletePack(pack.id))}>Delete pack</button>
      </section>)}
    </div>
  </>;
}
