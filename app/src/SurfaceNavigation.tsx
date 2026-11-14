import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Trash, Crosshair, Plus, X } from "@phosphor-icons/react";
import { activeSite, surfaceDistance, uid } from "./study";
import { clearsAvoidAreas } from "./routeAvoidance";
import type { MissionStop } from "./study";
import { sketchRoute } from "./routeSketch";
import { bearing, travelTime } from "./surfaceRoutes";
import type { LunarPoint, Mobility, RouteLeg, RouteResult } from "./surfaceRoutes";
import SensorNavigation from "./SensorNavigation";
import { useWorkspace } from "./WorkspaceContext";

type PickStopDetails = {name:string; description:string};
type View = "mission" | "return" | "saved";
type Pick = "lander" | "stop" | "origin" | "avoid" | "anchor";
type Draft = { lander: LunarPoint; stops: MissionStop[]; origin?: LunarPoint; avoid: LunarPoint[][] };
const EMPTY_STOPS: MissionStop[] = [];
const EMPTY_AREAS: LunarPoint[][] = [];
const presets = { rover: { speed: 1, grade: 12 }, walking: { speed: 0.6, grade: 10 } };
const messages: Record<string, string> = {
  "blocked-point": "A start or stop is on steep terrain, a data gap, or inside an avoid area.",
  "missing-coverage": "Installed LOLA terrain does not cover at least one leg.",
  "no-route": "No route met the terrain and avoid-area constraints in the search area.",
  "search-limit": "The terrain search reached its limit.",
  "duplicate-point": "Two locations are too close together for terrain screening.",
};
const km = (meters: number) => `${(meters / 1000).toFixed(2)} km`;
const coordinate = ([lon, lat]: LunarPoint) => `${lat.toFixed(5)}°, ${lon.toFixed(5)}° E`;

export default function SurfaceNavigation() {
  const { study } = useWorkspace();
  const site = activeSite(study);
  return <RoutePlanner key={`${study.id}:${study.active}:${site.lon}:${site.lat}`} initialLander={[site.lon, site.lat]} />;
}

function RoutePlanner({ initialLander }: { initialLander: LunarPoint }) {
  const { study, showRouteMap, setRouteOverlay, setRoutePicker, addAnnotation, mapActions, update } = useWorkspace();
  const [view, setView] = useState<View>("mission");
  const [positions, setPositions] = useState<{lander:LunarPoint; origin?:LunarPoint}>({ lander: initialLander });
  const draft: Draft = { ...positions, stops: study.missionStops ?? EMPTY_STOPS, avoid: study.prohibitedAreas ?? EMPTY_AREAS };
  const currentDraft = useRef(draft);
  useEffect(() => {
    const prior = currentDraft.current;
    if (prior.avoid !== draft.avoid || prior.stops.length !== draft.stops.length
      || prior.stops.some((stop,i) => stop.point !== draft.stops[i]?.point)) {
      request.current?.abort();
      request.current = null;
      setPending(false);
      setResult(null);
      setMessage("");
    }
    currentDraft.current = draft;
  });
  const [anchor, setAnchor] = useState<LunarPoint>();
  const [track, setTrack] = useState<LunarPoint[]>([]);
  const [history, setHistory] = useState<Draft[]>([]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [vertices, setVertices] = useState<LunarPoint[]>([]);
  const [editedStop, setEditedStop] = useState<string>();
  const [mobility, setMobility] = useState<Mobility>("rover");
  const [profiles, setProfiles] = useState(presets);
  const { speed, grade } = profiles[mobility];
  const [stopMinutes, setStopMinutes] = useState(0);
  const [keepOrder, setKeepOrder] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const focusedMap = useRef(false);
  const routes = study.annotations.filter((annotation) => annotation.kind === "line");
  const saved = routes.find((route) => route.id === savedId) ?? routes[0];

  const sensorPath = useMemo(() => {
    if (view === "saved") return saved?.coordinates ?? [];
    return result?.status === "ok" ? result.legs.flatMap((leg,i) => i ? leg.path.slice(1) : leg.path) : [];
  }, [view,result,saved]);

  useEffect(() => () => {
    request.current?.abort();
    setRoutePicker(null);
    setRouteOverlay(null);
  }, [setRoutePicker, setRouteOverlay]);

  useEffect(() => {
    setRouteOverlay(view === "saved" && !track.length ? null : {
      studyId: study.id, lander: draft.lander, stops: draft.stops.map(stop => stop.point), avoid: draft.avoid,
      origin: view === "return" ? draft.origin : undefined,
      draft: vertices, legs: result?.legs ?? [], track,
      playback: result?.status === "ok" ? {
        mobility, speed, stopMinutes: view === "mission" ? stopMinutes : 0,
        names: ["Lander", ...(view === "return" ? ["Return start"] : draft.stops.map((stop, i) => stop.name || `Stop ${i + 1}`))],
      } : undefined,
    });
  }, [view, study.id, study.missionStops, study.prohibitedAreas, positions, vertices, result, track, mobility, speed, stopMinutes, setRouteOverlay]);

  function cancelRequest() {
    request.current?.abort();
    request.current = null;
    setPending(false);
  }

  function invalidate() {
    cancelRequest();
    setResult(null);
    setMessage("");
  }

  function edit(next: Draft) {
    setHistory((items) => [...items.slice(-29), draft]);
    applyDraft(next);
    invalidate();
  }

  function applyDraft(next: Draft) {
    currentDraft.current = next;
    setPositions({ lander: next.lander, origin: next.origin });
    update({ missionStops: next.stops, prohibitedAreas: next.avoid });
  }

  function addStop(point: LunarPoint, name = "", description = "") {
    const current = currentDraft.current;
    if (current.stops.length >= 6) return;
    const stop = { id: uid(), point, name, description };
    setEditedStop(stop.id);
    setHistory(items => [...items.slice(-29),current]);
    applyDraft({ ...current, stops: [...current.stops,stop] });
    invalidate();
    if (current.stops.length === 5) finishPicking();
  }

  function finishPicking() {
    setRoutePicker(null);
    setPick(null);
    setVertices([]);
  }

  function centerLander() {
    showRouteMap();
    // Opening the dock can mount a new map on the next render.
    requestAnimationFrame(() => mapActions.current?.focus(...draft.lander));
    focusedMap.current = true;
  }

  function startPicking(kind: Pick) {
    setVertices([]);
    setPick(kind);
    if (focusedMap.current) showRouteMap();
    else centerLander();
    setRoutePicker((point) => {
      if (kind === "avoid") {
        setVertices((current) => current.length < 32 ? [...current, point] : current);
        return;
      }
      if (kind === "stop") { addStop(point); return; }
      if (kind === "anchor") setAnchor(point);
      else edit({ ...currentDraft.current, [kind]: point });
      finishPicking();
    });
  }

  function changeView(next: View) {
    if (view === next) return;
    finishPicking();
    invalidate();
    setView(next);
  }

  const canRoute = view === "return" ? Boolean(draft.origin) : draft.stops.length > 0;
  const label = (item: number) => item === 0 ? "Lander" : view === "return" ? "Return start" : draft.stops[item-1]?.name || `Stop ${item}`;
  const length = (result?.legs ?? []).reduce((total, leg) => total + leg.distance_m, 0);
  const unchecked = result?.status === "unchecked";

  async function findRoute() {
    if (!canRoute || !(grade >= 1 && grade <= 35)) return;
    finishPicking();
    invalidate();
    showRouteMap();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const origin = view === "return" ? draft.origin : undefined;
    const fallback = (reason: string) => {
      if (request.current !== controller || controller.signal.aborted) return;
      const candidate = sketchRoute(draft.lander,draft.stops.map(stop => stop.point),origin,keepOrder,draft.avoid);
      const clear = candidate.status === "unchecked" && candidate.legs.every(leg => clearsAvoidAreas(leg.path,draft.avoid));
      setResult(clear ? candidate : null);
      setMessage(clear ? reason :
        "No detour clears the prohibited areas. Check whether a stop or the lander is inside an area.");
      revealResult();

    };
    const timeout = window.setTimeout(() => {
      fallback(messages["search-limit"]);
      controller.abort();
    }, 25_000);
    try {
      const response = await fetch("/api/routes", {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lander: draft.lander, stops: draft.stops.map(stop => stop.point), avoid: draft.avoid, mobility,
          origin, max_grade_deg: grade, keep_order: keepOrder,
        }),
      });
      const data = await response.json() as RouteResult & { error?: string };
      if (request.current !== controller || controller.signal.aborted) return;
      if (data.status === "ok" && response.ok && data.legs.every(leg => clearsAvoidAreas(leg.path,draft.avoid))) {
        setResult(data);
        revealResult();
      } else if (data.status === "ok") fallback("Terrain screening did not find a route that clears the prohibited areas.");
      else fallback(messages[data.status] ?? data.error ?? "Terrain screening is unavailable.");
    } catch {
      if (!controller.signal.aborted) fallback("Terrain screening is unavailable.");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function revealResult() {
    requestAnimationFrame(() => document.getElementById("surface-route-result")?.scrollIntoView({block:"nearest"}));
  }

  function saveRoute() {
    if (!result || unchecked) return;
    const coords: LunarPoint[] = [];
    const legEnds: number[] = [];
    const legs = result.legs.map(({ path, ...leg }, index) => {
      coords.push(...(index ? path.slice(1) : path));
      legEnds.push(coords.length - 1);
      return leg;
    });
    if (coords.length > 2000 || study.annotations.length >= 1000) {
      setMessage("This route exceeds the study’s annotation limits and cannot be saved.");
      return;
    }
    const id = uid();
    const name = view === "return" ? "Return to lander" : `Mission traverse · ${draft.stops.length} ${draft.stops.length === 1 ? "stop" : "stops"}`;
    addAnnotation({ id, name, kind: "line", color: "#67b1ff", coordinates: coords,
      note: `${km(length)} · ${travelTime(length, speed, view === "mission" ? stopMinutes : 0)} · ${Array.from(new Set(legs.map((leg) => `${leg.source} (${leg.spacing_m} m)`))).join(", ")}`,
      route: { lander: draft.lander, stops: view === "return" && draft.origin ? [draft.origin] : draft.stops.map(stop => stop.point),
        stopDetails: view === "mission" ? draft.stops.map(({name,description}) => ({name,description})) : undefined,
        mobility, speed, stopMinutes: view === "mission" ? stopMinutes : 0, maxGrade: grade,
        order: result.order, legs, legEnds, avoid: draft.avoid } });
    setSavedId(id);
    setMessage("Route added to Saved routes.");
  }

  function changeStop(id: string, details: Partial<PickStopDetails>) {
    const stops = currentDraft.current.stops.map(stop => stop.id === id ? { ...stop,...details } : stop);
    currentDraft.current = { ...currentDraft.current, stops };
    update({ missionStops:stops });
  }

  function legSummary(leg: RouteLeg) {
    return <li key={`${leg.start}:${leg.end}`}>
      <strong>{label(leg.start)} → {label(leg.end)}</strong>
      <span>{km(leg.distance_m)} · {travelTime(leg.distance_m, speed)}</span>
      {leg.spacing_m !== null && <small>↑ {Math.round(leg.ascent_m ?? 0)} m · {leg.grade_deg?.toFixed(1)}° max grade · {leg.source} {leg.spacing_m} m</small>}
    </li>;
  }

  return <section className="surface-navigation" aria-label="Surface navigation">
    <div className="panel-scroll surface-nav-content">
    <div className="surface-nav-tabs" role="group" aria-label="Navigation view">
      <button aria-pressed={view === "mission"} onClick={() => changeView("mission")}>Plan mission</button>
      <button aria-pressed={view === "return"} onClick={() => changeView("return")}>Return to lander</button>
      <button aria-pressed={view === "saved"} onClick={() => changeView("saved")}>Saved routes</button>
    </div>

    <div className="surface-nav-tools" >
    <SensorNavigation key={mobility} anchor={anchor ?? draft.lander} pickAnchor={() => startPicking("anchor")}
      mobility={mobility} path={sensorPath} speed={speed} onTrack={setTrack} onReturn={(position) => {
        edit({ ...draft, origin:position }); setView("return"); finishPicking();
      }} />
    </div>
    {pick === "anchor" && <div className="surface-nav-card" role="status">
      Click the Moon map to set the known sensor position.
      <button onClick={finishPicking}>Cancel picking</button>
    </div>}
    {view === "saved" ? <>
      {saved ? <>
        <label>Saved traverse<select value={saved.id} onChange={(event) => setSavedId(event.target.value)}>
          {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
        </select></label>
        <p>{saved.note}</p>
        <p>{km((saved.route?.legs.reduce((sum, leg) => sum + leg.distance_m, 0)) ??
          saved.coordinates.slice(1).reduce((sum, point, index) => sum + surfaceDistance(saved.coordinates[index], point) * 1000, 0))}</p>
        {saved.route ? <button onClick={() => {
          const data = saved.route!;
          const avoid = draft.avoid.length ? draft.avoid : data.avoid;
          edit({ lander: data.lander, stops: data.order[0] === 0 ? data.order.slice(1, -1).map((stop) => ({id: uid(), point:data.stops[stop-1], name:data.stopDetails?.[stop-1]?.name ?? "", description:data.stopDetails?.[stop-1]?.description ?? ""})) : draft.stops, avoid,
            origin: data.order[0] === 1 ? data.stops[0] : undefined });
          setMobility(data.mobility);
          setProfiles((current) => ({ ...current, [data.mobility]: { speed: data.speed, grade: data.maxGrade } }));
          setKeepOrder(true);
          setStopMinutes(data.stopMinutes);
          setView(data.order[0] === 1 ? "return" : "mission");
          const savedOrder = data.order[0] === 0 ? [0, ...data.stops.map((_, i) => i + 1), 0] : [1, 0];
          const legs = data.legs.map((leg, i) => ({ ...leg, start: savedOrder[i], end: savedOrder[i + 1],
            path: saved.coordinates.slice(i ? data.legEnds[i - 1] : 0, data.legEnds[i] + 1) }));
          if (legs.every(leg => clearsAvoidAreas(leg.path,avoid))) {
            setResult({ status:"ok", order:savedOrder, legs });
          } else setMessage("This saved route crosses a prohibited area. Find route to recalculate it.");
          showRouteMap();
        }}>Open route</button> : <label>Effective pace (m/s)<input type="number" min="0" step="0.1" value={speed || ""}
          onChange={(event) => setProfiles({ ...profiles, [mobility]: { grade, speed: Number(event.target.value) } })} />
          <small>Travel time {travelTime(saved.coordinates.slice(1).reduce((sum, point, index) => sum + surfaceDistance(saved.coordinates[index], point) * 1000, 0), speed)}</small></label>}
        <button onClick={() => { showRouteMap(); mapActions.current?.focus(...saved.coordinates[0]); }}>Show on map</button>
      </> : <p>No saved traverses in this study.</p>}
    </> : <>
      <label>Mobility<select value={mobility} onChange={(event) => { setMobility(event.target.value as Mobility); invalidate(); }}>
        <option value="rover">Wheeled rover</option><option value="walking">Suited astronaut</option>
      </select></label>
      <div className="surface-nav-card">
        <strong>Lander</strong>
        <small>{coordinate(draft.lander)}</small>
        <div className="surface-nav-row lander-actions">
          <button title="Show location" aria-label="Show location" onClick={centerLander}><Crosshair size={17} /></button>
          <button title="Move location pin" aria-label="Move location pin" onClick={() => startPicking("lander")}><MapPin size={17} /></button>
        </div>
      </div>
      {view === "mission" ? <div className="surface-nav-card">
        <div className="surface-nav-row"><strong>Mission stops</strong><small>{draft.stops.length}/6</small></div>
        <ol className="surface-stop-list">
          {draft.stops.map((stop,index) => <li className="surface-stop-item" key={stop.id}>
            <span className="surface-stop-pin">{index+1}</span>
            <div className={`surface-stop-fields ${editedStop === stop.id ? "expanded" : ""}`}>
              {editedStop === stop.id ? <>
                <input aria-label={`Stop ${index+1} name`} placeholder={`Stop ${index+1} name`} maxLength={100} value={stop.name} onChange={e =>
                  changeStop(stop.id,{ name:e.target.value })} />
                <textarea aria-label={`Stop ${index+1} description`} placeholder="Description (optional)" maxLength={2000} rows={1} value={stop.description} onChange={e =>
                  changeStop(stop.id,{ description:e.target.value })} />
              </> : <button className="surface-stop-summary" onClick={() => setEditedStop(stop.id)}>
                <strong>{stop.name || `Stop ${index+1}`}</strong>
                {stop.description && <small>{stop.description}</small>}
              </button>}
            </div>
            <div className="surface-stop-actions">
              <button title={`Show stop ${index+1} on map`} aria-label={`Show stop ${index+1} on map`} onClick={() => { showRouteMap(); mapActions.current?.focus(...stop.point); }}><MapPin size={16} /></button>
              <button className="surface-stop-delete" title={`Remove stop ${index+1}`} aria-label={`Remove stop ${index+1}`} onClick={() => {
                finishPicking(); setEditedStop(undefined); edit({ ...draft, stops:draft.stops.filter(item => item.id !== stop.id) });
              }}><Trash size={15} /></button>
            </div>
          </li>)}
        </ol>
        <button className="add-stops-button" title={pick === "stop" ? "Finish adding stops" : "Add stops on map"} aria-label={pick === "stop" ? "Finish adding stops" : "Add stops on map"} aria-pressed={pick === "stop"} disabled={draft.stops.length >= 6}
          onClick={() => pick === "stop" ? finishPicking() : startPicking("stop")}>
          {pick === "stop" ? <X size={17} /> : <Plus size={18} />}
        </button>
        {pick === "stop" && <small role="status">Click the map for each stop. Select Done when finished.</small>}
        {study.annotations.some((item) => item.kind === "point") && <select aria-label="Add saved point as stop" value=""
          disabled={draft.stops.length >= 6} onChange={(event) => {
            const point = study.annotations.find((item) => item.id === event.target.value);
            if (point) { finishPicking(); addStop(point.coordinates[0],point.name,point.note); }
          }}>
          <option value="">Add a saved point</option>
          {study.annotations.filter((item) => item.kind === "point").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>}
      </div> : <div className="surface-nav-card">
        <strong>Return start</strong>
        {draft.origin && <small>{coordinate(draft.origin)}</small>}
        <button onClick={() => startPicking("origin")}>Pick position on map</button>
        {draft.stops.length > 0 && <select aria-label="Start return at a mission stop" value="" onChange={(event) => {
          if (event.target.value === "") return;
          finishPicking();
          edit({ ...draft, origin: draft.stops[Number(event.target.value)].point });
        }}>
          <option value="">Start at a mission stop</option>
          {draft.stops.map((stop, index) => <option key={index} value={index}>{stop.name || `Stop ${index+1}`} · {coordinate(stop.point)}</option>)}
        </select>}
      </div>}
      <div className="surface-nav-row">
        <button disabled={draft.avoid.length >= 8} onClick={() => startPicking("avoid")}>Avoid area</button>
        <button disabled={!history.length} onClick={() => {
          finishPicking(); invalidate(); applyDraft(history.at(-1)!); setHistory(history.slice(0, -1));
        }}>Undo</button>
      </div>
      {draft.avoid.map((polygon, index) => <div key={index} className="surface-nav-row">
        <small>Avoid area {index + 1} · {polygon.length} vertices</small>
        <button onClick={() => { finishPicking(); edit({ ...draft, avoid: draft.avoid.filter((_, i) => i !== index) }); }}
          aria-label={`Remove avoid area ${index + 1}`}>Remove</button>
      </div>)}
      {pick && pick !== "anchor" && pick !== "stop" && <div className="surface-nav-card" role="status">
        <span>{pick === "avoid" ? `Click along the boundary · ${vertices.length}/32 vertices`
          : `Click the Moon map to set the ${{ lander: "lander", origin: "return start", anchor: "known sensor position" }[pick]}.`}</span>
        <div className="surface-nav-row">
          {pick === "avoid" && <button disabled={vertices.length < 3} onClick={() => {
            edit({ ...draft, avoid: [...draft.avoid, vertices] }); finishPicking();
          }}>Finish area</button>}
          {pick === "avoid" && <button disabled={!vertices.length} onClick={() => setVertices(vertices.slice(0, -1))}>Undo vertex</button>}
          <button onClick={finishPicking}>Cancel picking</button>
        </div>
      </div>}
      <details className="surface-nav-card">
        <summary>Route settings</summary>
        <label>Effective pace (m/s)<input type="number" min="0" step="0.1" value={speed || ""} onChange={(event) => {
          setProfiles({ ...profiles, [mobility]: { grade, speed: Number(event.target.value) } }); invalidate();
        }} /></label>
        <label>Terrain slope limit (°)<input type="number" min="1" max="35" value={grade || ""} onChange={(event) => {
          setProfiles({ ...profiles, [mobility]: { speed, grade: Number(event.target.value) } }); invalidate();
        }} /></label>
        {view === "mission" && <>
          <label>Planned stops (min)<input type="number" min="0" value={stopMinutes} onChange={(event) => {
            setStopMinutes(Math.max(0, Number(event.target.value))); invalidate();
          }} /></label>
          <label className="surface-nav-check"><input type="checkbox" checked={keepOrder} onChange={(event) => {
            setKeepOrder(event.target.checked); invalidate();
          }} /> Keep my order</label>
        </>}
      </details>
      {message && !unchecked && <p id={result ? undefined : "surface-route-result"} role="status">{message}</p>}
      {result && <div id="surface-route-result" className="surface-nav-card surface-nav-result" aria-live="polite">
        <strong>{unchecked ? "Terrain unchecked" : view === "return" ? "Return route" : "Proposed traverse"}</strong>
        {unchecked && <p>{message} The dashed detour respects prohibited areas. Its terrain has not been checked.</p>}
        {!unchecked && result.legs.some((leg) => (leg.spacing_m ?? 0) >= 1000) && (
          <p>Some legs use coarse global terrain (~1.9 km grid). Small craters, steep slopes, and obstacles can be missed.</p>
        )}
        <ol className="surface-route-flow" aria-label="Proposed stop order">
          {result.order.map((stop,i) => <li key={i}>{label(stop)}</li>)}
        </ol>
        <strong>{km(length)} · {travelTime(length, speed, view === "mission" ? stopMinutes : 0)}</strong>
        {!unchecked && <small>{view === "mission" ? "Blue outbound · dashed gold return. " : "Dashed gold return. "}Preview in Geometry & timeline.</small>}
        {!unchecked && <small>↑ {Math.round(result.legs.reduce((total, leg) => total + (leg.ascent_m ?? 0), 0))} m total ascent · {Math.max(...result.legs.map((leg) => leg.grade_deg ?? 0)).toFixed(1)}° max grade</small>}
        {!unchecked && view === "return" && result.legs[0]?.path[1] && <p>
          Next waypoint {coordinate(result.legs[0].path[1])} · {Math.round(bearing(result.legs[0].path[0], result.legs[0].path[1])) % 360}° from lunar north
        </p>}
        <details><summary>Leg details</summary>
          <ol className="surface-nav-legs">{result.legs.map(legSummary)}</ol>
        </details>
        {!unchecked && <button onClick={saveRoute}>Save route</button>}
      </div>}
    </>}
    </div>
    {view !== "saved" && <div className="surface-nav-footer">
        {pending ? <button onClick={cancelRequest}>Cancel search</button>
          : <button disabled={!canRoute || (!!pick && pick !== "stop") || grade < 1 || grade > 35} onClick={() => void findRoute()}>Find route</button>}
      </div>}
  </section>;
}
