import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { activeSite } from "./study";
type OfflineStatus = {
  offline: boolean;
  tiles: number;
  bytes: number;
  disk_free_bytes: number;
  note: string;
  ancestor_fallbacks: number;
  layers: { layer: string; level: number; tiles: number; bytes: number }[];
  jobs: {
    id: string;
    status: string;
    done: number;
    total: number;
    message: string;
    layer: string;
    level: number;
  }[];
  packs: { status: string; layer: string; level: number; bbox: number[] }[];
};
async function api<T>(path: string, data?: unknown): Promise<T> {
  const r = await fetch("/api/offline/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error);
  return body;
}
export default function OfflinePanel() {
  const w = useWorkspace(),
    point = activeSite(w.study);
  const [status, setStatus] = useState<OfflineStatus>(),
    [message, setMessage] = useState(""),
    [layer, setLayer] = useState("imagery"),
    [level, setLevel] = useState(8),
    [radius, setRadius] = useState(20);
  const max =
    layer === "imagery"
      ? 8
      : layer === "elevation"
        ? 6
        : layer === "hillshade"
          ? 5
          : 2;
  const downloading = status?.jobs.some(job => ["starting", "running"].includes(job.status));
  const refresh = async () => {
    try {
      setStatus(await api<OfflineStatus>("status"));
    } catch (e) {
      setMessage(String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };
  const download = (global: boolean, zoom: number) =>
    run(async () => {
      const dlat = ((radius / 1737.4) * 180) / Math.PI,
        dlon = Math.min(
          180,
          dlat / Math.max(0.0001, Math.cos((point.lat * Math.PI) / 180)),
        );
      let west = Math.max(-180, point.lon - dlon),
        east = Math.min(180, point.lon + dlon);
      if (
        point.lat + dlat >= 90 ||
        point.lat - dlat <= -90 ||
        point.lon - dlon < -180 ||
        point.lon + dlon > 180
      ) {
        west = -180;
        east = 180;
      }
      const bbox = global
        ? [-180, -90, 180, 90]
        : [
            west,
            Math.max(-90, point.lat - dlat),
            east,
            Math.min(90, point.lat + dlat),
          ];
      const result = await api<{ tiles: number; estimated_bytes: number }>(
        "download",
        { layer, level: zoom, bbox },
      );
      setMessage(
        `Download started: ${result.tiles} tiles; conservative estimate ${(result.estimated_bytes / 1e6).toFixed(0)} MB. Keep this server running.`,
      );
    });
  return (
    <>
      <h2>Offline maps</h2>
      <p>
        The app, geometry kernels and acquired DEMs run on your computer. NASA
        imagery is persisted by the local server, so browser cache eviction does
        not remove downloaded tile packs.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={status?.offline || false}
          onChange={(e) =>
            run(() => api("config", { offline: e.target.checked }))
          }
        />
        Force offline imagery mode · never fetch missing tiles
      </label>
      <label className="field">
        Layer
        <select
          value={layer}
          onChange={(e) => {
            setLayer(e.target.value);
            setLevel(
              e.target.value === "imagery"
                ? 8
                : e.target.value === "elevation"
                  ? 6
                  : e.target.value === "hillshade"
                    ? 5
                    : 2,
            );
          }}
        >
          {["imagery", "elevation", "hillshade", "slope"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </label>
      <div className="field-pair">
        <label className="field">
          Native zoom level
          <input
            type="number"
            min="0"
            max={max}
            value={level}
            onChange={(e) =>
              setLevel(
                Math.max(0, Math.min(max, Math.floor(Number(e.target.value)))),
              )
            }
          />
        </label>
        <label className="field">
          Study-region radius (km)
          <input
            type="number"
            min="1"
            max="200"
            value={radius}
            onChange={(e) =>
              setRadius(Math.max(1, Math.min(200, Number(e.target.value))))
            }
          />
        </label>
      </div>
      <p>
        Study point: {point.lat.toFixed(5)}°, {point.lon.toFixed(5)}° E. Packs
        include all parent levels so zooming out also works offline.
      </p>
      <button disabled={status?.offline || downloading} onClick={() => download(false, level)}>
        Download high-quality study region
      </button>
      <button disabled={status?.offline || downloading} onClick={() => download(true, 2)}>
        Download whole-Moon overview (42 tiles)
      </button>
      <details>
        <summary>Full global native detail</summary>
        <p>
          Imagery through level 8 contains 174,762 tiles including parents.
          Conservative disk estimate is about 7 GB; actual size varies. Other
          layers have lower native maximum levels. A complete download can take
          hours; progress is saved on your computer. After stopping or restarting,
          resume below to reuse downloaded tiles and retry missing ones.
        </p>
        <button
          disabled={status?.offline || downloading}
          onClick={() => download(true, level)}
        >
          Download whole Moon through level {level}
        </button>
      </details>
      <p className="ai-progress" role="status">
        {message}
      </p>
      {status && (
        <>
          <p>
            {status.tiles.toLocaleString()} cached tiles ·{" "}
            {(status.bytes / 1e6).toFixed(1)} MB ·{" "}
            {(status.disk_free_bytes / 1e9).toFixed(1)} GB free
          </p>
          <p className="hint">
            {status.note} Upscaled ancestor fallbacks served this session:{" "}
            {status.ancestor_fallbacks}.
          </p>
          {status.jobs.map((j) => (
            <article key={j.id}>
              <strong>{j.layer} · level {j.level} · {j.status}</strong>
              <div className="download-progress-line">
                <progress max={j.total || 1} value={j.done} aria-label={`${j.layer} map download progress`} />
                <span>{j.total ? `${Math.round((j.done / j.total) * 100)}%` : "Preparing"}</span>
              </div>
              <p>
                {j.message} ({j.done}/{j.total})
              </p>
              {["starting", "running"].includes(j.status) && (
                <button onClick={() => run(() => api("cancel", { job: j.id }))}>
                  Cancel download
                </button>
              )}
              {["cancelled", "interrupted", "incomplete", "error"].includes(j.status) && (
                <button disabled={status.offline || downloading} onClick={() => run(() => api("resume", { job: j.id }))}>
                  Resume missing tiles
                </button>
              )}
            </article>
          ))}
          <details>
            <summary>Downloaded coverage</summary>
            {status.packs.map((p, i) => (
              <p key={i}>
                {p.status} · {p.layer} level {p.level} · bounds [
                {p.bbox.join(", ")}]
              </p>
            ))}
            <table>
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Level</th>
                  <th>Tiles</th>
                </tr>
              </thead>
              <tbody>
                {status.layers.map((r) => (
                  <tr key={r.layer + r.level}>
                    <td>{r.layer}</td>
                    <td>{r.level}</td>
                    <td>{r.tiles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </>
  );
}
