import { missionFrame, missionRoute, playbackClock, PLAYBACK_SECONDS, routePlayback } from "./missionPlayback";
import { updateStopActivity } from "./missionActivities";
import { moveActivity, reorderActivities, recommendPlan } from "./planning";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Crosshair,
  MapPin,
  Moon,
  Plus,
  Planet as SatelliteIcon,
  Trash,
} from "@phosphor-icons/react";
import { useWorkspace } from "./WorkspaceContext";
import {
  activeSite,
  activeStart,
  cursorTime,
  newSatellite,
  rowAt,
  SITES,
  totals,
  uid,
} from "./study";
import type { MissionEvent, Study } from "./study";
import MapView from "./MapView";
import { HexColorPicker } from "react-colorful";
import RangeSlider from "./RangeSlider";

export function Numeric({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = "any",
  unit,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | string;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { notify } = useWorkspace();
  const commit = () => {
    const n = Number(draft);
    if (
      draft !== null &&
      draft !== "" &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max
    )
      onChange(n);
    else if (draft !== null)
      notify(`${label}: enter a number between ${min} and ${max}.`);
    setDraft(null);
  };
  return (
    <label className="field">
      <span>
        {label}
        {unit && <small>{unit}</small>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { notify } = useWorkspace();
  return (
    <label className="field">
      <span>
        {label}
        <small>UTC · seconds</small>
      </span>
      <input
        type="datetime-local"
        min="1969-01-01T00:00:00"
        max="2049-12-01T00:00:00"
        step="1"
        value={draft ?? value.replace("Z", "").slice(0, 19)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) {
            const d = Date.parse(draft + "Z");
            if (
              Number.isFinite(d) &&
              d >= Date.parse("1969-01-01") &&
              d < Date.parse("2050-01-01")
            )
              onChange(new Date(d).toISOString());
            else notify("Enter a valid UTC date between 1969 and 2049.");
          }
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>{title}</summary>
      <div className="section-content">{children}</div>
    </details>
  );
}
export function MapPanel() {
  const w = useWorkspace();
  return (
    <MapView
      study={w.study}
      geometry={w.geometry}
      compare={w.compare}
      onChange={w.update}
      onAnnotation={w.addAnnotation}
      actions={w.mapActions}
      tool={w.tool}
      setTool={w.setTool}
      onStatus={w.notify}
    />
  );
}
export function ExplorerPanel() {
  const {
    study: s,
    update,
    showPanel,
    selectAnnotation,
    mapActions,
  } = useWorkspace();
  return (
    <div className="panel-scroll explorer" data-tour="explorer">
      <div className="project-heading">
        <Moon size={17} />
        <strong>{s.name}</strong>
      </div>
      <Section title="Scenarios">
        {(["A", "B"] as const).map((id) => (
          <button
            key={id}
            className={`scenario-item ${s.active === id ? "selected" : ""}`}
            onClick={() => update({ active: id })}
          >
            <span className={`scenario-badge ${id}`}>{id}</span>
            <span>
              <strong>{id === "A" ? "Baseline" : "Comparison"}</strong>
              <small>
                {(id === "A" ? s.start : s.compareStart)
                  .replace("T", " ")
                  .slice(5, 19)}{" "}
                UTC
              </small>
            </span>
          </button>
        ))}
        <button
          className="text-button"
          onClick={() => {
            update({
              compareSite: { ...s.site },
              compareStart: new Date(
                Date.parse(s.start) + 86400000,
              ).toISOString(),
              active: "B",
            });
            showPanel("map");
          }}
        >
          <Plus size={13} />
          Duplicate A +24 hours
        </button>
      </Section>

      <Section title={`Annotations (${s.annotations.length})`}>
        {s.annotations.map((a) => (
          <div className="annotation-tree-row" key={a.id}>
            <button
              className="tree-button"
              onClick={() => {
                selectAnnotation(a.id);
                showPanel("inspector");
                mapActions.current?.focus(...a.coordinates[0]);
              }}
            >
              <MapPin size={14} color={a.color} />
              <span>{a.name}</span>
            </button>
            <button
              className="annotation-delete"
              aria-label={`Delete annotation ${a.name}`}
              title={`Delete ${a.name}`}
              onClick={() => {
                update({ annotations: s.annotations.filter((x) => x.id !== a.id) });
                selectAnnotation(null);
              }}
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
        {!s.annotations.length && (
          <p className="hint">
            Use the map tools to add notes, traverses and study boundaries.
          </p>
        )}
      </Section>
      <Section title="Map layers">
        <label className="field">
          <span>Surface layer</span>
          <select
            value={s.layer}
            onChange={(e) =>
              update({ layer: e.target.value as Study["layer"] })
            }
          >
            <option value="imagery">LROC global imagery</option>
            <option value="elevation">LOLA color elevation</option>
            <option value="hillshade">LOLA hillshade</option>
            <option value="slope">LOLA slope</option>
          </select>
        </label>
        <label className="layer-row">
          <input
            type="checkbox"
            checked={!!s.showRecommendations}
            onChange={(e) => update({ showRecommendations: e.target.checked })}
          />
          <span>Show proposed locations</span>
        </label>
        {(
          [
            ["grid", "Coordinate grid"],
            ["lighting", "Time-dependent solar lighting"],
            ["directions", "Sun / Earth direction arrows"],
          ] as const
        ).map(([key, name]) => (
          <label className="layer-row" key={key}>
            <input
              type="checkbox"
              checked={s[key]}
              onChange={(e) => update({ [key]: e.target.checked })}
            />
            {name}
          </label>
        ))}
        <label className="layer-row">
          <input
            type="checkbox"
            checked={!!s.stars}
            onChange={(e) => {
              const checked = e.target.checked;
              update({ stars: checked, ...(checked ? { view: "3d" as const } : {}) });
              if (checked) requestAnimationFrame(() => mapActions.current?.home());
            }}
          />
          Stars (3D only)
        </label>
        {s.stars && (
          <label className="field star-blur-control">
            <span>Starfield soft focus</span>
            <RangeSlider
              label="Starfield soft focus"
              min={0}
              max={4}
              step={0.5}
              value={s.starBlur ?? 0}
              onChange={(starBlur) => update({ starBlur })}
            />
            <small>{s.starBlur ? `${s.starBlur}px` : "Sharp"}</small>
          </label>
        )}
      </Section>
    </div>
  );
}
export function InspectorPanel() {
  const {
    study: s,
    update,
    geometry,
    compare,
    error,
    computing,
    mapActions,
    selectedAnnotation,
    showPanel,
    selectAnnotation,
    notify,
    preferences,
  } = useWorkspace();
  const scenarioSwitchId = useId();
  const site = activeSite(s),
    row = rowAt(s.active === "A" ? geometry : compare, cursorTime(s));
  const setSite = (p: Partial<typeof site>) =>
    update(
      s.active === "A"
        ? { site: { ...site, ...p } }
        : { compareSite: { ...site, ...p } },
    );
  const selected = s.annotations.find((a) => a.id === selectedAnnotation);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  useEffect(() => setColorDraft(selected?.color ?? null), [selected?.id, selected?.color]);
  const saveAnnotationColor = (color: string) => {
    if (!selected) return;
    update({ annotations: s.annotations.map((x) => x.id === selected.id ? { ...x, color } : x) });
  };
  return (
    <div className="panel-scroll inspector" data-tour="inspector">
      <div className="scenario-switch">
        {(["A", "B"] as const).map((id) => (
          <button
            className={s.active === id ? "active" : ""}
            key={id}
            onClick={() => update({ active: id })}
          >
            {s.active === id && preferences.animations && <motion.span className="scenario-switch-indicator" layoutId={`${scenarioSwitchId}-active`} transition={{ type: "spring", duration: 0.3, bounce: 0.1 }} />}
            <span className={`scenario-badge ${id}`}>{id}</span>
            <span>{id === "A" ? "Baseline" : "Comparison"}</span>
          </button>
        ))}
      </div>
      <Section title="Study point navigator">
        <label className="field">
          <span>Preset region</span>
          <select
            value={
              SITES.find((x) => x.lat === site.lat && x.lon === site.lon)
                ?.name || "custom"
            }
            onChange={(e) => {
              const site = SITES.find((x) => x.name === e.target.value);
              if (site)
                update(
                  s.active === "A"
                    ? { site: { ...site } }
                    : { compareSite: { ...site } },
                );
            }}
          >
            <option value="custom">Custom point</option>
            {SITES.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Point name</span>
          <input
            value={site.name}
            maxLength={100}
            onChange={(e) => setSite({ name: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <Numeric
            label="Latitude"
            unit="°"
            value={site.lat}
            min={-90}
            max={90}
            onChange={(lat) => setSite({ lat })}
          />
          <Numeric
            label="Longitude E"
            unit="°"
            value={site.lon}
            min={-180}
            max={180}
            onChange={(lon) => setSite({ lon })}
          />
        </div>
        <Numeric
          label={
            s.analysis?.enabled && s.analysis.terrain
              ? "Fallback reference height"
              : "Reference height"
          }
          unit="m"
          value={site.height}
          min={-10000}
          max={100000}
          onChange={(height) => setSite({ height })}
        />
        <button
          className="text-button"
          onClick={() => mapActions.current?.site()}
        >
          <Crosshair size={14} />
          Frame this point
        </button>
      </Section>
      <Section title="Time & calculation">
        <DateField
          label={`Scenario ${s.active} start`}
          value={activeStart(s)}
          onChange={(start) =>
            update(s.active === "A" ? { start } : { compareStart: start })
          }
        />
        <div className="field-pair">
          <Numeric
            label="Duration"
            unit="hours"
            value={s.duration}
            min={1 / 60}
            max={744}
            onChange={(duration) => {
              if (s.events.some((e) => e.offset + e.duration > duration)) {
                notify(
                  "Some mission activities extend beyond this duration. Shorten or remove them first.",
                );
                return;
              }
              update({ duration, cursor: Math.min(s.cursor, duration) });
            }}
          />
          <label className="field">
            <span>Sample step</span>
            <select
              value={s.step}
              onChange={(e) => update({ step: Number(e.target.value) })}
            >
              {[60, 300, 900, 1800, 3600].map((v) => (
                <option key={v} value={v}>
                  {v < 3600 ? `${v / 60} min` : "1 hour"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DateField
          label="Exact cursor"
          value={cursorTime(s)}
          onChange={(time) => {
            const start = Date.parse(
              s.alignment === "elapsed" ? activeStart(s) : s.start,
            );
            const cursor = (Date.parse(time) - start) / 3600000;
            if (cursor >= 0 && cursor <= s.duration) update({ cursor });
            else
              notify("Cursor must lie inside the selected mission interval.");
          }}
        />
        <div className="model-state">
          {computing
            ? "Calculating with SPICE…"
            : error
              ? error
              : "SPICE · MOON_ME / DE421 · LT+S"}
        </div>
      </Section>
      <Section title="At the time cursor">
        <p className="mono hint">
          {cursorTime(s).replace("T", " ").slice(0, 19)} UTC
        </p>
        {(["sun", "earth"] as const).map((body) => (
          <div className={`body-readout ${body}`} key={body}>
            <div>
              <strong>{body === "sun" ? "Sun" : "Earth"}</strong>
              <span>{row ? `${row[body].elevation.toFixed(4)}°` : "—"}</span>
            </div>
            <small>
              {row
                ? row[body].elevation > row[body].radius
                  ? "Full disk above reference"
                  : row[body].elevation < -row[body].radius
                    ? "Below reference"
                    : "Partial disk above reference"
                : "No result at this time"}
              <span>Az {row ? row[body].azimuth.toFixed(3) + "°" : "—"}</span>
            </small>
          </div>
        ))}
        <p className="hint">
          {s.analysis?.enabled
            ? "Body-center angles above the local horizontal. See Mission analysis for terrain, eclipse, station and energy results."
            : "Local ideal 0° horizon; enable Mission analysis for additional research models."}{" "}
          Cursor geometry interpolates calculated samples.
        </p>
      </Section>
      <Section title="Spacecraft & planning satellites">
        {s.satellites.map((sat) => (
          <details className="satellite-editor" open key={sat.id}>
            <summary>
              <SatelliteIcon size={14} color={sat.color} />
              {sat.name}
            </summary>
            <div className="satellite-fields">
              <label className="field">
                <span>Name</span>
                <input
                  value={sat.name}
                  maxLength={100}
                  onChange={(e) =>
                    update({
                      satellites: s.satellites.map((x) =>
                        x.id === sat.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              {sat.ephemeris ? (
                <p className="hint">
                  NASA LRO definitive trajectory · 15 Sep–15 Dec 2022. Positions
                  come from SPK; circular orbital parameters do not apply.
                  Change the interval outside coverage to receive a
                  data-coverage error.
                </p>
              ) : (
                <div className="field-pair">
                  {(
                    [
                      ["altitude", "Altitude", "km", 10, 100000],
                      ["inclination", "Inclination", "°", 0, 180],
                      ["raan", "RAAN", "°", 0, 360],
                      ["phase", "Phase", "°", 0, 360],
                    ] as const
                  ).map(([key, label, unit, min, max]) => (
                    <Numeric
                      key={key}
                      label={label}
                      unit={unit}
                      min={min}
                      max={max}
                      value={sat[key]}
                      onChange={(v) =>
                        update({
                          satellites: s.satellites.map((x) =>
                            x.id === sat.id ? { ...x, [key]: v } : x,
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <div className="satellite-bottom">
                <label>
                  Orbit color{" "}
                  <input
                    aria-label={`${sat.name} color`}
                    type="color"
                    value={sat.color}
                    onChange={(e) =>
                      update({
                        satellites: s.satellites.map((x) =>
                          x.id === sat.id ? { ...x, color: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="text-button danger"
                  onClick={() =>
                    update({
                      satellites: s.satellites.filter((x) => x.id !== sat.id),
                    })
                  }
                >
                  <Trash size={13} />
                  Remove
                </button>
              </div>
              <p className="hint">
                {sat.ephemeris ? (
                  "FDF/GSFC ACTUAL trajectory product; reconstructed positions, not live telemetry."
                ) : (
                  <>
                    Period:{" "}
                    {(((s.active === "A" ? geometry : compare)?.orbits[sat.id]
                      ?.period_seconds || 0) /
                      60) |
                      0}{" "}
                    min · User-defined circular J2000 orbit; not telemetry.
                  </>
                )}
              </p>
            </div>
          </details>
        ))}
        <button
          className="text-button"
          disabled={s.satellites.length >= 12}
          onClick={() =>
            update({
              satellites: [...s.satellites, newSatellite(s.satellites.length)],
            })
          }
        >
          <Plus size={14} />
          Add planning satellite
        </button>
      </Section>
      <Section title="Annotation properties">
        {selected ? (
          <>
            {selected.kind === "polygon" && <button onClick={() => showPanel("science")}>Find landing sites and study windows here</button>}
            <label className="field">
              <span>Label</span>
              <input
                maxLength={100}
                value={selected.name}
                onChange={(e) =>
                  update({
                    annotations: s.annotations.map((x) =>
                      x.id === selected.id ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Study notes</span>
              <textarea
                maxLength={2000}
                rows={3}
                value={selected.note}
                onChange={(e) =>
                  update({
                    annotations: s.annotations.map((x) =>
                      x.id === selected.id ? { ...x, note: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label className="field color-picker-field">
              <span>Annotation color</span>
              <HexColorPicker
                color={colorDraft || selected.color}
                onChange={setColorDraft}
                onPointerUp={() => colorDraft && saveAnnotationColor(colorDraft)}
                onKeyUp={() => colorDraft && saveAnnotationColor(colorDraft)}
              />
              <input
                aria-label="Annotation color hex value"
                value={colorDraft || selected.color}
                pattern="#[0-9a-fA-F]{6}"
                onChange={(e) => {
                  setColorDraft(e.target.value);
                }}
                onBlur={() => colorDraft && /^#[0-9a-fA-F]{6}$/.test(colorDraft) && saveAnnotationColor(colorDraft)}
              />
            </label>
            <p className="hint mono">
              {selected.coordinates
                .map((c) => c.map((v) => v.toFixed(5)).join(", "))
                .join(" · ")}
            </p>
            <button
              className="text-button danger"
              onClick={() => {
                update({
                  annotations: s.annotations.filter(
                    (x) => x.id !== selected.id,
                  ),
                });
                selectAnnotation(null);
              }}
            >
              <Trash size={13} />
              Delete annotation
            </button>
          </>
        ) : (
          <p className="hint">
            Select an annotation in the explorer to edit its label, notes and
            color.
          </p>
        )}
      </Section>
      <button
        className="text-button"
        style={{ padding: "14px" }}
        onClick={() => showPanel("science")}
      >
        Open mission analysis →
      </button>
      <Section title="Study notes" open={false}>
        <textarea
          aria-label="Study description"
          rows={5}
          maxLength={20000}
          value={s.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </Section>
    </div>
  );
}
export function AnalysisPanel() {
  const {
    study: s,
    update,
    geometry: a,
    compare: b,
    computing,
    error,
    routeOverlay,
    selectedAnnotation,
    mapActions,
  } = useWorkspace();
  const [mode, setMode] = useState<"elevation" | "windows">("elevation");
  const graphRef = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState({ width: 900, height: 145 });
  useEffect(() => {
    const element = graphRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setPlotSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const plotHeight = Math.max(30, plotSize.height - 38),
    plotWidth = Math.max(50, plotSize.width - 70);

  const [playingStudy, setPlayingStudy] = useState<string | null>(null);
  const [speed, setSpeed] = useState<keyof typeof PLAYBACK_SECONDS>("fast");
  const playing = playingStudy === s.id;
  const route = useMemo(() => routePlayback(missionRoute(
    s.annotations, s.prohibitedAreas, routeOverlay?.studyId === s.id ? routeOverlay : null, selectedAnnotation,
  ), s.missionStops), [s.annotations, s.prohibitedAreas, s.id, s.missionStops, routeOverlay, selectedAnnotation]);
  const frame = missionFrame(s, route);
  const clock = useMemo(() => playbackClock(s.duration, s.events, PLAYBACK_SECONDS[speed]), [s.duration, s.events, speed]);
  const currentCursor = useRef(s.cursor);
  useLayoutEffect(() => { currentCursor.current = s.cursor; }, [s.cursor]);
  useEffect(() => {
    if (!playing) return;
    let timestamp = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const cursor = clock.cursorAt(clock.secondsAt(currentCursor.current) + Math.min(.25, (now - timestamp) / 1000));
      timestamp = now;
      currentCursor.current = cursor;
      update({ cursor });
      if (cursor === s.duration) setPlayingStudy(null);
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, clock, update, s.duration]);

  const seek = (cursor: number) => {
    setPlayingStudy(null);
    update({ cursor });
  };
  const all = [...(a?.rows || []), ...(b?.rows || [])];
  const min =
      Math.floor(
        Math.min(
          -5,
          ...all.flatMap((r) => [r.sun.elevation, r.earth.elevation]),
        ) / 10,
      ) * 10,
    max =
      Math.ceil(
        Math.max(
          5,
          ...all.flatMap((r) => [r.sun.elevation, r.earth.elevation]),
        ) / 10,
      ) * 10;
  const y = (v: number) => 14 + ((max - v) / (max - min)) * plotHeight,
    x = (hours: number) => 45 + (hours / s.duration) * plotWidth;
  const ta = totals(a),
    tb = totals(b);
  return (
    <div className="analysis-panel" data-tour="analysis">
      <div className="analysis-toolbar">
        <div className="segmented">
          <button
            className={mode === "elevation" ? "active" : ""}
            onClick={() => setMode("elevation")}
          >
            Elevation
          </button>
          <button
            className={mode === "windows" ? "active" : ""}
            onClick={() => setMode("windows")}
          >
            Reference windows
          </button>
        </div>
        <span className="legend">
          <i className="sun-swatch" />
          Sun
          <i className="earth-swatch" />
          Earth<span>— A · - - B</span>
        </span>
        <span className="calculation-status">
          {computing
            ? "Calculating…"
            : error
              ? "Calculation unavailable"
              : `${a?.rows.length || 0} samples / scenario`}
        </span>
      </div>
      <div className="analysis-graph" ref={graphRef}>
        {mode === "elevation" ? (
          <svg
            viewBox={`0 0 ${plotSize.width} ${plotSize.height}`}
            role="img"
            aria-label="Calculated Sun and Earth elevation over the mission"
          >
            <defs>
              <clipPath id="plot-area">
                <rect x="45" y="8" width={plotWidth} height={plotHeight + 10} />
              </clipPath>
            </defs>
            {Array.from({ length: 5 }, (_, i) => {
              const v = min + ((max - min) * i) / 4;
              return (
                <g key={i}>
                  <line
                    className={v === 0 ? "reference-line" : "plot-grid"}
                    x1="45"
                    x2={45 + plotWidth}
                    y1={y(v)}
                    y2={y(v)}
                  />
                  <text x="36" y={y(v) + 3} textAnchor="end">
                    {v.toFixed(0)}°
                  </text>
                  <text
                    x={x((s.duration * i) / 4)}
                    y={plotSize.height - 5}
                    textAnchor="middle"
                  >
                    {s.alignment === "elapsed"
                      ? `+${((s.duration * i) / 4).toFixed(1)} h`
                      : new Date(
                          Date.parse(s.start) +
                            ((s.duration * i) / 4) * 3600000,
                        )
                          .toISOString()
                          .slice(11, 19)}
                  </text>
                </g>
              );
            })}
            <g clipPath="url(#plot-area)">
              {(
                [
                  ["A", a],
                  ["B", b],
                ] as const
              ).flatMap(([id, g]) =>
                (["sun", "earth"] as const).map((body) => (
                  <polyline
                    key={id + body}
                    fill="none"
                    stroke={body === "sun" ? "#efc36d" : "#72b4ff"}
                    strokeWidth="1.8"
                    strokeDasharray={id === "B" ? "5 4" : undefined}
                    opacity={s.active === id ? 1 : 0.5}
                    points={(g?.rows || [])
                      .map(
                        (r) =>
                          `${x(s.alignment === "elapsed" ? r.elapsed : (Date.parse(r.time) - Date.parse(s.start)) / 3600000)},${y(r[body].elevation)}`,
                      )
                      .join(" ")}
                  />
                )),
              )}
              <line
                x1={x(s.cursor)}
                x2={x(s.cursor)}
                y1="10"
                y2={14 + plotHeight}
                className="time-line"
              />
            </g>
          </svg>
        ) : (
          <div className="window-grid">
            {(
              [
                ["A", a],
                ["B", b],
              ] as const
            ).flatMap(([id, g]) =>
              (["sun", "earth"] as const).map((body) => (
                <div key={id + body} className="window-row">
                  <span>
                    {id} · {body}
                  </span>
                  <div>
                    {Array.from({ length: 96 }, (_, i) => {
                      const t =
                        Date.parse(
                          s.alignment === "elapsed"
                            ? id === "A"
                              ? s.start
                              : s.compareStart
                            : s.start,
                        ) +
                        ((i + 0.5) / 96) * s.duration * 3600000;
                      const r = rowAt(g, new Date(t).toISOString());
                      return (
                        <i
                          key={i}
                          title={
                            r
                              ? `${r.time} · ${r[body].elevation.toFixed(3)}°`
                              : "Outside scenario interval"
                          }
                          style={{
                            background: r
                              ? r[body].elevation > 0
                                ? body === "sun"
                                  ? "#efc36d"
                                  : "#72b4ff"
                                : "#283b52"
                              : "transparent",
                          }}
                        />
                      );
                    })}
                  </div>
                  <strong>{g ? totals(g)[body].toFixed(2) : "—"} h</strong>
                </div>
              )),
            )}
          </div>
        )}
      </div>
      <div className="analysis-metrics">
        <span>Center above reference</span>
        <strong>
          Sun A {a ? ta.sun.toFixed(2) : "—"} h / B{" "}
          {b ? tb.sun.toFixed(2) : "—"} h
        </strong>
        <strong>
          Earth A {a ? ta.earth.toFixed(2) : "—"} h / B{" "}
          {b ? tb.earth.toFixed(2) : "—"} h
        </strong>
        <span className="mission-playback-status">
          {frame.flight && frame.flight.stage !== "Landed" ? `${frame.flight.stage} · ${(frame.flight.altitude / 1000).toFixed(1)} km above terrain · illustrative`
            : frame.rover ? `${frame.rover.stage} · ${(frame.rover.distance / 1000).toFixed(2)} km${frame.rover.ascent === null ? "" : ` · ~${Math.round(frame.rover.ascent)} m ascent`}${frame.estimatedTraverse ? " · estimated timing" : ""}`
            : frame.activity?.name ?? (frame.flight ? "Lander on surface" : route ? "Awaiting traverse" : "No traverse route selected")}
        </span>
      </div>
      <div className="transport">
        <button
          aria-label="Mission start"
          onClick={() => seek(0)}
        >
          |◀
        </button>
        <button
          aria-label={playing ? "Pause playback" : "Play timeline"}
          className={playing ? "active" : ""}
          onClick={() => {
            if (playing) setPlayingStudy(null);
            else {
              if (s.cursor >= s.duration) {
                currentCursor.current = 0;
                update({ cursor: 0 });
              }
              const site = activeSite(s);
              if (route || s.events.some(event => event.type === "landing" || event.type === "ascent")) {
                mapActions.current?.frameMission([[site.lon, site.lat], ...(route?.legs.flatMap(item => item.leg.path) ?? [])]);
              }
              setPlayingStudy(s.id);
            }
          }}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button
          aria-label="Mission end"
          onClick={() => seek(s.duration)}
        >
          ▶|
        </button>
        <span>T+{s.cursor.toFixed(3)} h</span>
        <RangeSlider
          label="Mission time"
          min={0}
          max={s.duration}
          step={1 / 3600}
          value={s.cursor}
          onChange={seek}
        />
        <select aria-label="Playback speed" value={speed} onChange={event => setSpeed(event.target.value as keyof typeof PLAYBACK_SECONDS)}>
          <option value="fast">Fast</option>
          <option value="normal">Normal</option>
          <option value="slow">Slow</option>
        </select>
        <label>
          Step{" "}
          <select
            aria-label="Time step"
            onChange={(e) =>
              seek(Math.min(s.duration, s.cursor + Number(e.target.value) / 3600))
            }
            value="0"
          >
            <option value="0">Forward…</option>
            <option value="1">1 second</option>
            <option value="60">1 minute</option>
            <option value="3600">1 hour</option>
          </select>
        </label>
      </div>
    </div>
  );
}
export function TablePanel() {
  const { study: s, geometry, compare, update } = useWorkspace();
  const result = s.active === "A" ? geometry : compare;
  return (
    <div className="panel-scroll data-table">
      <div className="table-caption">
        <h2>Scenario {s.active} · Geometry samples</h2>
        <p>MOON_ME / DE421 · UTC · angles in degrees · {activeSite(s).name}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>UTC</th>
            <th>Sun az.</th>
            <th>Sun elev.</th>
            <th>Earth az.</th>
            <th>Earth elev.</th>
            {s.satellites.map((x) => (
              <th key={x.id}>{x.name} elev.</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result?.rows.map((r) => (
            <tr
              key={r.time}
              onClick={() => {
                const cursor =
                  s.alignment === "elapsed"
                    ? r.elapsed
                    : (Date.parse(r.time) - Date.parse(s.start)) / 3600000;
                if (cursor >= 0 && cursor <= s.duration) update({ cursor });
              }}
            >
              <td>{r.time.replace("T", " ").slice(0, 19)}</td>
              <td>{r.sun.azimuth.toFixed(4)}</td>
              <td className="sun-text">{r.sun.elevation.toFixed(4)}</td>
              <td>{r.earth.azimuth.toFixed(4)}</td>
              <td className="earth-text">{r.earth.elevation.toFixed(4)}</td>
              {s.satellites.map((x) => (
                <td key={x.id}>
                  {r.satellites[x.id]?.elevation.toFixed(3) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!result && (
        <p className="empty-state">
          Waiting for a successful calculation. Check the status bar for
          details.
        </p>
      )}
    </div>
  );
}
export function MissionPanel() {
  const w = useWorkspace(),
    s = w.study;
  const [stopName, setStopName] = useState("");
  const [stopDescription, setStopDescription] = useState("");
  const [stopPoint, setStopPoint] = useState("coordinates");
  const [stopLat, setStopLat] = useState("");
  const [stopLon, setStopLon] = useState("");
  const missionStops = s.missionStops ?? [];
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState<MissionEvent["type"]>("science"),
    [minutes, setMinutes] = useState(30),
    [hover, setHover] = useState<MissionEvent | null>(null),
    [draft, setDraft] = useState<ReturnType<typeof recommendPlan> | null>(null);
  const edit = (id: string, p: Partial<MissionEvent>) => {
    const event = s.events.find(item => item.id === id);
    if (event?.stopId && event.stopActivity && (p.offset !== undefined || p.duration !== undefined)) {
      const activityPatch = updateStopActivity(s, event.stopId, event.stopActivity, {
        ...(p.offset !== undefined ? { offset: p.offset } : {}),
        ...(p.duration !== undefined ? { duration: p.duration * 60 } : {}),
      });
      const events = activityPatch.events.map(item => item.id === id ? { ...item, ...p } : item);
      w.update({ missionStops: activityPatch.missionStops, events });
      return;
    }
    w.update({ events: s.events.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  };
  const add = (name = title, type = kind) => {
    if (!name.trim()) return;
    const offset = Math.min(s.cursor, s.duration),
      duration = Math.min(minutes / 60, s.duration - offset);
    w.update({
      events: [
        ...s.events,
        {
          id: uid(),
          name: name.trim().slice(0, 200),
          offset,
          duration,
          type,
          notes: "",
          done: false,
        },
      ],
    });
    setTitle("");
  };
  const when = (e: MissionEvent) =>
    `${e.name} | ${new Date(Date.parse(s.start) + e.offset * 3600000).toISOString()} - ${new Date(Date.parse(s.start) + (e.offset + e.duration) * 3600000).toISOString()} | T+${e.offset.toFixed(3)} h | ${e.duration * 60} min`;
  return (
    <div className="panel-scroll mission-panel" data-tour="mission">
      <div className="mission-header">
        <div>
          <h2>Mission plan</h2>
          <p>
            Activities use baseline A UTC: {s.start}. Drag blocks to change
            their start time.
          </p>
        </div>
        <button onClick={() => w.showPanel("tasks")}>Open tasks</button>
      </div>
      <details className="section">
        <summary>Mission stops · {missionStops.length}/6</summary>
        <div className="section-content">
          <button onClick={() => w.showPanel("navigation")}>Plan stops on the map</button>
          <ol className="surface-route-flow" aria-label="Mission stops">
            {missionStops.map((stop,i) => <li key={stop.id} title={stop.description}>{stop.name || `Stop ${i+1}`}</li>)}
          </ol>
          <form className="surface-stop-editor" onSubmit={event => {
            event.preventDefault();
            if (missionStops.length >= 6) return;
            const point = s.annotations.find(annotation => annotation.kind === "point" && annotation.id === stopPoint)?.coordinates[0];
            if (!point && stopPoint !== "coordinates") return;
            if (!point && (!stopLat.trim() || !stopLon.trim())) return;
            w.update({ missionStops:[...missionStops,{
              id:uid(), point:point ?? [Number(stopLon),Number(stopLat)], name:stopName.trim(), description:stopDescription.trim(),
            }] });
            setStopName(""); setStopDescription("");
          }}>
            <label>Stop location<select value={stopPoint} onChange={event => setStopPoint(event.target.value)}>
              <option value="coordinates">Enter coordinates</option>
              {s.annotations.filter(annotation => annotation.kind === "point").map(annotation =>
                <option key={annotation.id} value={annotation.id}>{annotation.name}</option>)}
            </select></label>
            {stopPoint === "coordinates" && <div className="field-pair">
              <label>Latitude (°)<input value={stopLat} type="number" min="-90" max="90" step="any" required onChange={e => setStopLat(e.target.value)} /></label>
              <label>Longitude (° E)<input value={stopLon} type="number" min="-180" max="180" step="any" required onChange={e => setStopLon(e.target.value)} /></label>
            </div>}
            <label>Stop name<input maxLength={100} value={stopName} onChange={event => setStopName(event.target.value)} /></label>
            <label>Description<textarea maxLength={2000} rows={2} value={stopDescription} onChange={event => setStopDescription(event.target.value)} /></label>
            <button disabled={missionStops.length >= 6}>Add mission stop</button>
          </form>
        </div>
      </details>
      <form
        className="quick-entry"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label="New activity name"
          placeholder="e.g. Collect surface samples"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          aria-label="New activity type"
          value={kind}
          onChange={(e) => setKind(e.target.value as MissionEvent["type"])}
        >
          {["science", "communication", "traverse", "power", "landing", "ascent"].map(
            (t) => (
              <option key={t}>{t}</option>
            ),
          )}
        </select>
        <input
          aria-label="New activity duration in minutes"
          type="number"
          min="1"
          max={s.duration * 60}
          value={minutes}
          onChange={(e) =>
            setMinutes(
              Math.max(1, Math.min(s.duration * 60, Number(e.target.value))),
            )
          }
        />
        <button className="primary">Add at cursor</button>
      </form>
      <div className="quick-templates">
        {[
          ["Science sampling", "science"],
          ["Downlink data", "communication"],
          ["Drive / traverse", "traverse"],
          ["Recharge / standby", "power"],
        ].map(([name, type]) => (
          <button
            key={type}
            onClick={() => add(name, type as MissionEvent["type"])}
          >
            + {name}
          </button>
        ))}
        <button onClick={() => setDraft(recommendPlan(s, w.geometry))}>
          Recommend plan mathematically
        </button>
        <button
          onClick={() => {
            w.showPanel("chat");
            w.notify("Ask the assistant to draft a mission plan.");
          }}
        >
          Plan with AI
        </button>
      </div>
      {draft && (
        <div className="plan-draft">
          <h3>Proposed additions</h3>
          {draft.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          {draft.events.map((e) => (
            <p key={e.id}>{when(e)}</p>
          ))}
          <button
            disabled={!draft.events.length}
            onClick={() => {
              w.update({ events: [...s.events, ...draft.events] });
              setDraft(null);
              w.notify(
                "Suggestions added. Review the new energy calculation and overlaps.",
              );
            }}
          >
            Add suggestions to plan
          </button>
          <button onClick={() => setDraft(null)}>Dismiss</button>
        </div>
      )}
      <div
        className="mission-strip"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("luna-activity");
          const rect = e.currentTarget.getBoundingClientRect();
          w.update({
            events: moveActivity(
              s,
              id,
              ((e.clientX - rect.left) / rect.width) * s.duration,
            ),
          });
        }}
      >
        {s.events.map((e) => (
          <button
            key={e.id}
            draggable
            title={when(e)}
            aria-label={when(e)}
            onMouseEnter={() => setHover(e)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(e)}
            onBlur={() => setHover(null)}
            onDragStart={(ev) => ev.dataTransfer.setData("luna-activity", e.id)}
            onClick={() => w.update({ cursor: e.offset, active: "A" })}
            style={{
              left: `${(e.offset / s.duration) * 100}%`,
              width: `${Math.max(1, (e.duration / s.duration) * 100)}%`,
            }}
          >
            {e.name}
          </button>
        ))}
      </div>
      <div className="mission-hover" role="status">
        {hover
          ? when(hover)
          : "Hover a block for its full name and UTC start/end. Drop on the timeline to reschedule."}
      </div>
      <div className="mission-scale">
        <span>T+0 h</span>
        <span>T+{s.duration} h</span>
      </div>
      {s.events.length === 0 && (
        <p>
          Add an activity above, or calculate a recommended plan after enabling
          Mission analysis.
        </p>
      )}
      {[...s.events]
        .sort((a, b) => a.offset - b.offset)
        .map((event) => (
          <details
            className="mission-event"
            key={event.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const events = reorderActivities(
                s,
                e.dataTransfer.getData("luna-activity"),
                event.id,
              );
              if (events) w.update({ events });
              else
                w.notify(
                  "Activities cannot fit sequentially in this study duration.",
                );
            }}
          >
            <summary
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("luna-activity", event.id)
              }
              title="Drag to reorder, or click to edit"
            >
              <span className="drag-activity">⠿</span>
              <input
                type="checkbox"
                checked={event.done}
                aria-label={`Complete ${event.name}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => edit(event.id, { done: e.target.checked })}
              />
              <strong>{event.name}</strong>
              <span className="mono">
                T+{event.offset.toFixed(2)} h · {event.duration * 60} min
              </span>
            </summary>
            <div className="event-fields">
              {event.stopId && <div className="surface-nav-row">
                <span>At {missionStops.find(stop => stop.id === event.stopId)?.name || "mission stop"}</span>
                <button onClick={() => {
                  const stop = missionStops.find(item => item.id === event.stopId);
                  if (stop) { w.showRouteMap(); w.mapActions.current?.focus(...stop.point); }
                }}>Show stop on map</button>
              </div>}
              <label className="field">
                Activity name
                <input
                  maxLength={200}
                  value={event.name}
                  disabled={Boolean(event.stopId)}
                  onChange={(e) => edit(event.id, { name: e.target.value })}
                />
              </label>
              <div className="field-pair">
                <Numeric
                  label="Start after mission begins"
                  unit="h"
                  value={event.offset}
                  min={0}
                  max={s.duration - event.duration}
                  onChange={(offset) => edit(event.id, { offset })}
                />
                <Numeric
                  label="Duration"
                  unit="min"
                  value={event.duration * 60}
                  min={0}
                  max={(s.duration - event.offset) * 60}
                  onChange={(v) => edit(event.id, { duration: v / 60 })}
                />
              </div>
              <label className="field">
                Type
                <select
                  value={event.type}
                  disabled={Boolean(event.stopId)}
                  onChange={(e) =>
                    edit(event.id, {
                      type: e.target.value as MissionEvent["type"],
                    })
                  }
                >
                  {[
                    "science",
                    "communication",
                    "traverse",
                    "power",
                    "landing",
                    "ascent",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Notes
                <textarea
                  value={event.notes}
                  rows={3}
                  maxLength={5000}
                  onChange={(e) => edit(event.id, { notes: e.target.value })}
                />
              </label>
              <p className="hint">{when(event)}</p>
              <button className="danger" onClick={() => {
                if (event.stopId && event.stopActivity) {
                  const patch = updateStopActivity(s, event.stopId, event.stopActivity, { enabled: false });
                  w.update(patch);
                } else w.update({ events: s.events.filter((e) => e.id !== event.id) });
              }}>Remove activity</button>
            </div>
          </details>
        ))}
      <p className="hint">
        Dropping onto another activity resequences the list from T+0 with no
        gaps. Dropping on the timeline changes only that block. Overlapping
        activities add power loads.
      </p>
    </div>
  );
}
