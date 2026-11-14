import { RecommendationsPanel } from "./RecommendationsPanel";
import { useState } from "react";
import {
  Check,
  Flask,
  DownloadSimple,
  Info,
  Play,
  Warning,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useWorkspace } from "./WorkspaceContext";
import { Numeric, Section } from "./Panels";
import { SCIENCE_DEFAULTS, SCIENCE_LIMITS } from "./science";
import type { ScienceConfig, ScienceResult, ScienceRow } from "./science";
import { NASA_EXAMPLES, nasaExample } from "./examples";
import { cursorTime, rowAt } from "./study";
import { fileName, saveFile } from "./exports";
import { aiAPI } from "./ai";
const fmt = (n: number | undefined, d = 2) =>
  n === undefined ? "—" : n.toFixed(d);
function Badge({
  children,
  state = "unknown",
}: {
  children: React.ReactNode;
  state?: "pass" | "fail" | "unknown";
}) {
  return (
    <span className={`assessment-badge ${state}`}>
      {state === "pass" ? <Check size={12} /> : <Info size={12} />} {children}
    </span>
  );
}
export function NasaExamples() {
  const { addStudy, showPanel } = useWorkspace();
  return (
    <div className="nasa-examples">
      {NASA_EXAMPLES.map((example) => (
        <article key={example.id}>
          <h3>{example.name}</h3>
          <p>{example.purpose}</p>
          <div>
            <button
              className="primary"
              onClick={() => {
                addStudy(nasaExample(example.id));
                showPanel("science");
              }}
            >
              <Play size={13} />
              Open working example
            </button>
            <a href={example.source} target="_blank" rel="noreferrer">
              NASA source ↗
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
export default function SciencePanel() {
  const {
    study: s,
    update,
    geometry,
    compare,
    computing,
    error,
    recalculate,
    showPanel,
    notify,
    preferences,
    openPreferences,
    mapActions,
  } = useWorkspace();
  const [tab, setTab] = useState<"results" | "inputs">("results");
  const [terrainReview, setTerrainReview] = useState("");
  const [terrainReviewError, setTerrainReviewError] = useState(false);
  const [terrainReviewBusy, setTerrainReviewBusy] = useState(false);
  const cfg = { ...SCIENCE_DEFAULTS, ...s.analysis };
  const result = (s.active === "A" ? geometry : compare)?.analysis;
  const time = Date.parse(cursorTime(s));
  const spacecraft = rowAt(
    s.active === "A" ? geometry : compare,
    cursorTime(s),
  )?.satellites;
  const row = result?.rows.reduce<ScienceRow | undefined>(
    (best, r) =>
      !best ||
      Math.abs(Date.parse(r.time) - time) <
        Math.abs(Date.parse(best.time) - time)
        ? r
        : best,
    undefined,
  );
  const current =
    row &&
    time >= Date.parse(result!.rows[0].time) &&
    time <= Date.parse(result!.rows[result!.rows.length - 1].time)
      ? row
      : undefined;
  const edit = (patch: Partial<ScienceConfig>) =>
    update({ analysis: { ...cfg, ...patch } });
  const inspectTerrain = async () => {
    const ai = preferences.ai;
    if (ai.provider !== "ollama" || !ai.model) {
      openPreferences("ai");
      setTerrainReviewError(true);
      setTerrainReview("Choose and connect a vision-capable local Ollama model in Preferences → AI & models.");
      return;
    }
    setTerrainReviewBusy(true);
    setTerrainReviewError(false);
    setTerrainReview("Capturing terrain layers for local review…");
    try {
      const site = s.active === "A" ? s.site : s.compareSite;
      const captures = await mapActions.current?.captureViews(
        { lat: site.lat, lon: site.lon },
        ["hillshade", "elevation", "slope"],
      );
      if (!captures?.length) throw new Error("Open the lunar map once, then retry the terrain review.");
      const response = await aiAPI<{ review: string }>("terrain-review", {
        model: ai.model,
        images: captures.map((capture) => ({ label: capture.label, data: capture.image })),
        site: {
          name: site.name,
          latitude: site.lat,
          longitude: site.lon,
          start_utc: s.active === "A" ? s.start : s.compareStart,
          duration_hours: s.duration,
          terrain_coverage: result?.terrain.status ?? "unavailable",
          slope_deg: result?.landing.slope_deg ?? null,
          roughness_rms_m: result?.landing.roughness_rms_m ?? null,
          map_layers: captures.map((capture) => capture.label.split(" - ")[0]),
        },
      });
      setTerrainReview(response.review);
    } catch (error) {
      setTerrainReviewError(true);
      setTerrainReview(error instanceof Error ? error.message : String(error));
    } finally {
      setTerrainReviewBusy(false);
    }
  };
  const numeric = (key: keyof ScienceConfig, label: string, unit?: string) => {
    const [min, max] = SCIENCE_LIMITS[key] || [-1e9, 1e9];
    return (
      <Numeric
        key={key}
        label={label}
        unit={unit}
        value={Number(cfg[key])}
        min={min}
        max={max}
        onChange={(value) => edit({ [key]: value })}
      />
    );
  };
  return (
    <div className="panel-scroll science-panel" data-tour="science">
      <header className="science-header">
        <div>
          <h2>Mission analysis</h2>
        </div>
      </header>
      <div className="science-controls">
        <label className="science-switch">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />
          Enable models
        </label>
        {cfg.enabled && (
          <button
            className="text-button science-recalculate"
            disabled={computing}
            onClick={() => {
              recalculate();
              notify("Recalculating mission analysis for both scenarios.");
            }}
          >
            <ArrowsClockwise size={13} />
            {computing ? "Calculating…" : "Recalculate"}
          </button>
        )}
      </div>
      <div className="qualification">
        <Warning size={17} />
        <div>
          <strong>
            Research analysis · mission qualification not established
          </strong>
          <p>Research screening only · no landing or crew clearance.</p>
        </div>
      </div>
      <RecommendationsPanel />
      <nav className="science-tabs">
        {(["results", "inputs"] as const).map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "results"
              ? "Results & events"
              : t === "inputs"
                ? "Hardware & assumptions"
                : t === "examples"
                  ? "NASA examples"
                  : "Methods & evidence"}
          </button>
        ))}
      </nav>
      {tab === "inputs" ? (
        <>
          <p className="science-intro">
            All hardware values below are explicit scenario assumptions. They
            are not NASA spacecraft specifications. Changes recalculate both
            scenarios when models are enabled.
          </p>
          <Section title="Vehicle & terrain">
            <label className="field">
              <span>Vehicle context</span>
              <select
                value={cfg.vehicle}
                onChange={(e) => edit({ vehicle: e.target.value })}
              >
                {["rover", "lander", "hopper", "crewed"].map((x) => (
                  <option key={x} value={x}>
                    {x === "crewed"
                      ? "Crewed surface study"
                      : x === "hopper"
                        ? "Propulsive vacuum hopper"
                        : x === "lander"
                          ? "Robotic lander"
                          : "Surface rover"}
                  </option>
                ))}
              </select>
            </label>
            <label className="layer-row">
              <input
                type="checkbox"
                checked={cfg.terrain}
                onChange={(e) => edit({ terrain: e.target.checked })}
              />
              Use sampled LOLA terrain horizon where covered
            </label>
            <div className="science-fields">
              {numeric("mast_m", "Observer mast", "m")}
              {numeric(
                "height_uncertainty_m",
                "Relative-height perturbation",
                "m",
              )}
              {numeric("horizon_range_km", "Horizon radius", "km")}
              {numeric("horizon_step_deg", "Azimuth sample", "°")}
            </div>
            <p className="hint">
              Inside DEM coverage, the observer height becomes DEM ground height
              + mast for both geometry and analysis. Otherwise the user
              reference-sphere height is retained. Far-field bounding assumes no
              terrain above +15 km. This is a sensitivity bound, not a
              statistical confidence level.
            </p>
          </Section>
          <Section title="Earth station & downlink">
            <label className="field">
              <span>DSN site</span>
              <select
                value={cfg.station}
                onChange={(e) => edit({ station: e.target.value })}
              >
                <option value="DSS-14">Goldstone · DSS-14</option>
                <option value="DSS-43">Canberra · DSS-43</option>
                <option value="DSS-63">Madrid · DSS-63</option>
              </select>
            </label>
            <div className="science-fields">
              {numeric("station_mask_deg", "Minimum ground elevation", "°")}
              {numeric("frequency_ghz", "Carrier frequency", "GHz")}
              {numeric("tx_power_w", "Spacecraft transmit power", "W")}
              {numeric("tx_gain_dbi", "Transmit antenna gain", "dBi")}
              {numeric("rx_diameter_m", "Receive dish diameter", "m")}
              {numeric("rx_efficiency", "Aperture efficiency", "fraction")}
              {numeric("system_noise_k", "Receive system noise", "K")}
              {numeric(
                "other_losses_db",
                "Combined path / pointing losses",
                "dB",
              )}
              {numeric("bitrate_bps", "Information bitrate", "bit/s")}
              {numeric("required_ebno_db", "Required Eb/N0", "dB")}
              {numeric("implementation_loss_db", "Implementation loss", "dB")}
              {numeric("reserve_margin_db", "Design reserve", "dB")}
            </div>
            <p className="hint">
              Station coordinates and Earth rotation come from dated NASA
              kernels. The elevation mask, noise and RF hardware are user
              assumptions. Geometry is not a DSN reservation. No
              frequency-dependent station pattern, weather or interference
              model.
            </p>
          </Section>
          <Section title="Solar array & battery">
            <label className="field">
              <span>Panel orientation</span>
              <select
                value={cfg.panel_mode}
                onChange={(e) => edit({ panel_mode: e.target.value })}
              >
                <option value="tracking">Ideal Sun tracking</option>
                <option value="fixed">Fixed tilt and azimuth</option>
              </select>
            </label>
            <div className="science-fields">
              {numeric("panel_area_m2", "Panel area", "m²")}
              {numeric("panel_efficiency", "Cell efficiency", "fraction")}
              {numeric("panel_derating", "Combined derating", "fraction")}
              {numeric("panel_tilt_deg", "Tilt from horizontal", "°")}
              {numeric(
                "panel_azimuth_deg",
                "Normal azimuth (east of north)",
                "°",
              )}
              {numeric("battery_wh", "Usable battery capacity", "Wh")}
              {numeric("initial_soc", "Initial state of charge", "fraction")}
              {numeric("minimum_soc", "Minimum reserve", "fraction")}
              {numeric("charge_efficiency", "Charge efficiency", "fraction")}
              {numeric(
                "discharge_efficiency",
                "Discharge efficiency",
                "fraction",
              )}
              {numeric("base_load_w", "Continuous load", "W")}
              {numeric("active_load_w", "Additional load per activity", "W")}
            </div>
            <p className="hint">
              Activity loads add when they overlap. Uniform-disk eclipses reduce
              direct sunlight. Missing terrain uses a 0–100% solar range and a
              zero-generation conservative trace. No thermal/degradation or
              peak-current battery qualification.
            </p>
          </Section>
          <Section title="Terrain hazard screening">
            <div className="science-fields">
              {numeric("footprint_m", "Screening footprint radius", "m")}
              {numeric("slope_limit_deg", "User slope limit", "°")}
              {numeric("roughness_limit_m", "User residual RMS limit", "m")}
            </div>
            <p className="hint">
              A plane is fitted to native 5 m Site04 cells. These limits do not
              establish vehicle landing compatibility. Rocks below the grid
              scale, soil, plume and landing-navigation dispersions are unknown.
            </p>
          </Section>
          {cfg.vehicle === "hopper" && (
            <Section title="Ideal propulsive hop feasibility">
              <div className="science-fields">
                {numeric("hop_dry_mass_kg", "Dry mass", "kg")}
                {numeric("hop_propellant_kg", "Propellant", "kg")}
                {numeric("hop_isp_s", "Specific impulse", "s")}
                {numeric("hop_speed_m_s", "Launch speed", "m/s")}
                {numeric("hop_angle_deg", "Launch elevation", "°")}
              </div>
              <p className="hint">
                Tsiolkovsky delta-v and a short, flat-surface vacuum ballistic
                hop at g=1.625 m/s². No thrust-time history, reserves, guidance,
                terrain avoidance or trajectory validation. A rotor helicopter
                cannot operate in the lunar vacuum.
              </p>
            </Section>
          )}
        </>
      ) : !cfg.enabled ? (
        <div className="science-empty">
          <Flask size={32} />
          <h3>Enable coupled mission analysis</h3>
          <p>
            Compute eclipse loss, sampled terrain visibility, individual DSN
            access, RF margin, electrical energy, refined event brackets and
            hazard screening.
          </p>
          <button className="primary" onClick={() => edit({ enabled: true })}>
            Enable research models
          </button>
        </div>
      ) : computing ? (
        <div className="science-empty loading-surface">
          <h3><span className="inline-loader" aria-hidden="true" /> Calculating scenario models…</h3>
          <p>
            Terrain profiles and event searches may take several seconds.
            Results appear only when the requested inputs finish.
          </p>
        </div>
      ) : error ? (
        <div className="science-empty warning">
          <h3>Analysis unavailable</h3>
          <p>{error}</p>
          <p>
            For missing source files run <code>npm run setup:science</code> in
            app/, then restart the local server.
          </p>
        </div>
      ) : result ? (
        <>
          <div className="assessment-toolbar">
            <Badge>Research screening</Badge>
            <span>
              {result.rows.length} samples · {result.inputs.station} ·{" "}
              {result.terrain.status}
            </span>
            <button
              className="text-button"
              onClick={() =>
                saveFile(
                  JSON.stringify(result, null, 2),
                  "application/json",
                  `${fileName(s)}-${s.active}-analysis.json`,
                )
              }
            >
              <DownloadSimple size={13} />
              Analysis JSON
            </button>
            <button
              className="text-button"
              onClick={() => exportAnalysisCSV(result, fileName(s))}
            >
              Analysis CSV
            </button>
          </div>
          <div className="science-summary">
            <Metric
              label="Minimum battery · nominal"
              value={`${fmt(result.power.minimum_soc_nominal * 100, 1)}%`}
              note={
                result.power.nominal_reserve_pass
                  ? "Within configured reserve"
                  : "Below configured reserve"
              }
              state={result.power.nominal_reserve_pass ? "pass" : "fail"}
            />
            <Metric
              label="Minimum battery · conservative"
              value={
                result.rows.some((r) => r.terrain_unknown)
                  ? "Not established"
                  : `${fmt(result.power.minimum_soc_conservative * 100, 1)}%`
              }
              note={
                result.rows.some((r) => r.terrain_unknown)
                  ? "Terrain unknown; zero is only the worst-case energy bound"
                  : result.power.conservative_reserve_pass
                    ? "Within configured reserve"
                    : "Below configured reserve"
              }
              state={result.power.conservative_reserve_pass ? "pass" : "fail"}
            />
            <Metric
              label="Direct-to-Earth contact"
              value={
                result.access.available_hours_at_samples === 0 &&
                result.access.unknown_terrain_hours > 0
                  ? "Unknown"
                  : `${fmt(result.access.available_hours_at_samples)} h`
              }
              note={
                result.access.unknown_terrain_hours > 0
                  ? `${fmt(result.access.unknown_terrain_hours)} h require terrain data`
                  : "Known geometric access at samples; not a station reservation"
              }
            />
            <Metric
              label="Lunar eclipse duration"
              value={`${fmt(result.access.eclipse_hours_at_samples)} h`}
              note={
                result.access.eclipse_hours_at_samples > 0
                  ? "Sampled partial or total eclipse"
                  : "No eclipse detected in this interval"
              }
            />
          </div>
          <SystemChart result={result} />
          {s.satellites
            .filter((sat) => sat.ephemeris)
            .map((sat) => {
              const state = spacecraft?.[sat.id];
              return (
                <Section key={sat.id} title={sat.name}>
                  <p className="hint">
                    NASA definitive spacecraft trajectory · nearest shadow
                    sample (positions interpolate). Separate from surface power
                    simulation.
                  </p>
                  <div className="science-summary">
                    <Metric
                      label="Spacecraft shadow"
                      value={state?.solar_state || "No sample"}
                      note="Spherical Earth + Moon union, 512 solar rays"
                    />
                    <Metric
                      label="Spacecraft solar disk unocculted"
                      value={
                        state?.solar_unocculted_fraction === undefined
                          ? "—"
                          : `${fmt(state.solar_unocculted_fraction * 100, 1)}%`
                      }
                      note="No vehicle attitude, panel or instrument power model"
                    />
                  </div>
                  <p className="hint">{state?.ephemeris_source}</p>
                </Section>
              );
            })}
          <Section title="At the selected time">
            <div className="selected-time-stamp">
              <span>Calculated sample</span>
              <strong>
                {current?.time.replace("T", " ") || "Outside this scenario"}
              </strong>
              {current && <small>UTC · nearest sample to the timeline cursor</small>}
            </div>
            {current && (
              <>
                <div className="science-summary">
                  <Metric
                    label="Sunlight at site"
                    value={`${fmt(current.solar_fraction_nominal * 100, 1)}%`}
                    note={`Estimated range ${fmt(current.solar_fraction_lower * 100, 1)}–${fmt(current.solar_fraction_upper * 100, 1)}%`}
                  />
                  <Metric
                    label="Lunar eclipse"
                    value={current.eclipse.state}
                    note={`${fmt(current.eclipse.unocculted_fraction * 100, 1)}% of Sun visible`}
                  />
                  <Metric
                    label="Array power"
                    value={`${fmt(current.power_nominal_w)} W`}
                    note={`Minimum ${fmt(current.power_lower_w)} W · current load ${fmt(current.load_w)} W`}
                  />
                  <Metric
                    label="Link margin"
                    value={`${fmt(current.station.rf.nominal_margin_db)} dB`}
                    note={
                      current.station.access === null
                        ? "Line of sight unknown: terrain data missing"
                        : current.station.access
                          ? "Direct geometric contact available"
                          : "Earth is below the local horizon"
                    }
                    state={
                      current.station.access === true &&
                      current.station.rf.nominal_margin_db >= 0
                        ? "pass"
                        : current.station.access === false
                          ? "fail"
                          : "unknown"
                    }
                  />
                </div>
                <div className="engineering-table">
                  <div>
                    <span>Ground-station elevation</span>
                    <strong>
                      {fmt(current.station.earth_station_elevation_deg)}° / mask{" "}
                      {cfg.station_mask_deg}°
                    </strong>
                  </div>
                  <div>
                    <span>Station direction at study point</span>
                    <strong>
                      Az {fmt(current.station.lunar_azimuth_deg)}° · Elev{" "}
                      {fmt(current.station.lunar_elevation_deg)}°
                    </strong>
                  </div>
                  <div>
                    <span>Free-space loss · C/N0</span>
                    <strong>
                      {fmt(current.station.rf.free_space_loss_db)} dB ·{" "}
                      {fmt(current.station.rf.cn0_dbhz)} dBHz
                    </strong>
                  </div>
                  <div>
                    <span>Eb/N0 · one-way light time</span>
                    <strong>
                      {fmt(current.station.rf.ebno_db)} dB ·{" "}
                      {fmt(current.station.rf.propagation_delay_s, 4)} s
                    </strong>
                  </div>
                  <div>
                    <span>Terrain status</span>
                    <strong>
                      {!cfg.terrain
                        ? "Disabled · ideal reference plane"
                        : current.terrain_unknown
                          ? "Unknown: conservative generation is zero"
                          : "Sampled mask available"}
                    </strong>
                  </div>
                </div>
              </>
            )}
          </Section>
          <Section title="Terrain horizon & evidence">
            <HorizonPlot result={result} />
            <div className="terrain-inspection-actions">
              <button
                className="secondary"
                disabled={terrainReviewBusy}
                onClick={() => void inspectTerrain()}
              >
                {terrainReviewBusy
                  ? "Inspecting terrain locally…"
                  : "Inspect terrain images with local AI"}
              </button>
              {terrainReview && (
                <div
                  className={`site-ai-review ${terrainReviewError ? "error" : ""}`}
                  role="status"
                >
                  <strong>
                    {terrainReviewError
                      ? "Terrain review"
                      : "Qualitative terrain image review"}
                  </strong>
                  <p>{terrainReview}</p>
                </div>
              )}
            </div>
            <p className="terrain-coverage-status">{result.terrain.reason}</p>
            <div className="engineering-table">
              <div>
                <span>Observer datum height used</span>
                <strong>
                  {fmt(result.terrain.observer_height_m ?? undefined)} m
                </strong>
              </div>
              <div>
                <span>Native point grid · horizon radius</span>
                <strong>
                  {fmt(result.terrain.native_site_pixel_m, 0)} m ·{" "}
                  {fmt(result.terrain.range_km, 0)} km
                </strong>
              </div>
              <div>
                <span>Angular sample · global height bound</span>
                <strong>
                  {fmt(result.terrain.azimuth_step_deg)}° · +15 km assumption
                </strong>
              </div>
            </div>
          </Section>
          <Section title="Surface observer · refined event brackets">
            <p className="hint">
              Search step {result.events_method.search_step_seconds} s; bracket
              refinement ≤1 s. This is numerical bracketing, not one-second
              physical accuracy. Brief sub-step events and tangencies may be
              missed.
            </p>
            {result.events.length ? (
              <table className="science-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>UTC</th>
                    <th>Bracket</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((event, i) => (
                    <tr key={i}>
                      <td>
                        {event.kind}
                        <small>{event.direction}</small>
                      </td>
                      <td>{event.time.replace("T", " ").slice(0, 23)}</td>
                      <td>{event.bracket_seconds.toFixed(3)} s</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            update({
                              cursor: event.elapsed_hours,
                              alignment: "elapsed",
                            })
                          }
                        >
                          Go
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">
                No bracketed transitions found within this interval. This does
                not establish continuous visibility or absence of brief events.
              </p>
            )}
          </Section>
          <Section title="Landing terrain screening">
            <Badge
              state={
                result.landing.status === "screen-exceeds-threshold"
                  ? "fail"
                  : "unknown"
              }
            >
              {result.landing.status}
            </Badge>
            <p className="warning">
              Landing clearance:{" "}
              <strong>{result.landing.landing_clearance}</strong>. A DEM-only
              screen cannot certify a landing.
            </p>
            {result.landing.reason && (
              <p className="hint">{result.landing.reason}</p>
            )}
            <div className="engineering-table">
              <div>
                <span>Fitted plane slope</span>
                <strong>
                  {fmt(result.landing.slope_deg)}° / user limit{" "}
                  {cfg.slope_limit_deg}°
                </strong>
              </div>
              <div>
                <span>Residual RMS roughness</span>
                <strong>
                  {fmt(result.landing.roughness_rms_m, 3)} m / user limit{" "}
                  {cfg.roughness_limit_m} m
                </strong>
              </div>
              <div>
                <span>Footprint radius · native grid</span>
                <strong>
                  {fmt(result.landing.footprint_radius_m, 0)} m ·{" "}
                  {fmt(result.landing.grid_m, 0)} m
                </strong>
              </div>
            </div>
            <ul className="unknown-hazards">
              {(
                result.landing.unknown_hazards || [
                  "No local high-resolution DEM or hazard evidence",
                ]
              ).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Section>
          {result.hopper && (
            <Section title="Ideal hop screening">
              <div className="engineering-table">
                {Object.entries(result.hopper)
                  .filter(([key]) => key !== "scope")
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key.replaceAll("_", " ")}</span>
                      <strong>
                        {typeof value === "number" ? fmt(value) : value}
                      </strong>
                    </div>
                  ))}
              </div>
              <p className="hint">{result.hopper.scope}</p>
            </Section>
          )}
          <Section title="Candidate activity windows">
            <p className="candidate-compact-lede">Suggested activity start times</p>
            {result.candidate_windows.map((candidate) => (
              <div className="candidate" key={candidate.activity_id}>
                <h4>{candidate.activity_name}</h4>
                {candidate.windows.length ? (
                  candidate.windows.map((window, i) => (
                    <div key={i}>
                      <span>
                        {window.start_utc.replace("T", " ").slice(0, 19)} UTC
                        <small>
                          Projected conservative SOC ≥
                          {fmt(window.minimum_projected_soc * 100, 1)}% ·{" "}
                          {window.contact_at_samples
                            ? "contact at checked samples"
                            : "contact not continuous"}
                        </small>
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          const event = s.events.find(
                            (x) => x.id === candidate.activity_id,
                          );
                          if (!event) return;
                          update({
                            events: s.events.map((x) =>
                              x.id === event.id
                                ? { ...x, offset: window.start_offset_hours }
                                : x,
                            ),
                          });
                          notify(
                            "Candidate applied. Recalculate and review the new battery trace and overlaps.",
                          );
                        }}
                      >
                        Apply & recalculate
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="hint">
                    No window passed the configured sampled screening
                    constraints. Missing terrain or insufficient reserve is not
                    treated as success.
                  </p>
                )}
              </div>
            ))}
            <button
              className="text-button"
              onClick={() => showPanel("mission")}
            >
              Open mission activity editor →
            </button>
          </Section>
          <Section title="Limitations & qualification">
            <ul className="unknown-hazards">
              {result.limitations.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="hint">
              Export JSON for exact inputs, source/kernel metadata and methods.
              Commission independent model, data-coverage, uncertainty and
              vehicle-specific verification before operational use.
            </p>
          </Section>
        </>
      ) : (
        <div className="science-empty">
          Waiting for the requested analysis result.
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  state,
}: {
  label: string;
  value: string;
  note: string;
  state?: "pass" | "fail" | "unknown";
}) {
  return (
    <div className={`science-metric ${state || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function SystemChart({ result: r }: { result: ScienceResult }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const duration = Math.max(1, r.rows[r.rows.length - 1]?.elapsed || 1);
  const maxPower = Math.max(
    1,
    ...r.rows.map((x) => Math.max(x.power_nominal_w, x.load_w)),
  );
  const x = (v: number) => 45 + (v / duration) * 810;
  const soc = (v: number) => 20 + (1 - v) * 110;
  const power = (v: number) => 20 + (1 - v / maxPower) * 110;
  const nearestIndex = (elapsed: number) => r.rows.reduce(
    (best, row, index) => Math.abs(row.elapsed - elapsed) < Math.abs(r.rows[best].elapsed - elapsed) ? index : best,
    0,
  );
  const selected = activeIndex === null ? undefined : r.rows[activeIndex];
  const selectedX = selected ? x(selected.elapsed) : 0;
  return (
    <div className="systems-plot">
      <h3>Battery and solar input</h3>
      <svg
        viewBox="0 0 900 165"
        role="group"
        aria-label="Battery and solar input over mission time. Hover or focus the chart and use arrow keys to inspect a sample."
        tabIndex={0}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - bounds.left) / bounds.width) * 900;
          const elapsed = Math.max(0, Math.min(duration, ((position - 45) / 810) * duration));
          setActiveIndex(nearestIndex(elapsed));
        }}
        onMouseLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((index) => index ?? 0)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(r.rows.length - 1, (index ?? 0) + 1));
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, (index ?? 0) - 1));
          } else if (event.key === "Home") {
            event.preventDefault(); setActiveIndex(0);
          } else if (event.key === "End") {
            event.preventDefault(); setActiveIndex(r.rows.length - 1);
          }
        }}
      >
        <defs>
          <clipPath id="systems-clip">
            <rect x="45" y="15" width="810" height="120" />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1="45" x2="855" y1={soc(v)} y2={soc(v)} />
            <text x="35" y={soc(v) + 3} textAnchor="end">
              {v * 100}%
            </text>
            <text x={x(duration * v)} y="153" textAnchor="middle">
              +{fmt(duration * v, 1)} h
            </text>
          </g>
        ))}
        <g clipPath="url(#systems-clip)">
          <line
            className="reserve-line"
            x1="45"
            x2="855"
            y1={soc(r.power.reserve_floor)}
            y2={soc(r.power.reserve_floor)}
          />
          {(
            [
              ["soc_nominal", "#85beff", false],
              ["soc_conservative", "#85beff", true],
              ["power_nominal_w", "#efc36d", false],
              ["load_w", "#e49cac", true],
            ] as const
          ).map(([key, color, dashed]) => (
            <polyline
              key={key}
              fill="none"
              stroke={color}
              strokeWidth="1.7"
              strokeDasharray={dashed ? "5 4" : undefined}
              points={r.rows
                .map(
                  (row) =>
                    `${x(row.elapsed)},${key.startsWith("soc") ? soc(row[key]) : power(row[key])}`,
                )
                .join(" ")}
            />
          ))}
          {selected && (
            <g className="systems-cursor" pointerEvents="none">
              <line x1={selectedX} x2={selectedX} y1="15" y2="135" />
              {([
                [soc(selected.soc_nominal), "#85beff"],
                [soc(selected.soc_conservative), "#85beff"],
                [power(selected.power_nominal_w), "#efc36d"],
                [power(selected.load_w), "#e49cac"],
              ] as const).map(([yValue, color], index) => (
                <circle key={index} cx={selectedX} cy={yValue} r="3" fill={color} />
              ))}
            </g>
          )}
        </g>
      </svg>
      {selected && (
        <div className="systems-readout" aria-live="polite">
          <strong>{selected.time.replace("T", " ").replace("Z", " UTC")}</strong>
          <span>Battery {fmt(selected.soc_nominal * 100, 1)}% / {fmt(selected.soc_conservative * 100, 1)}%</span>
          <span>Solar {fmt(selected.power_nominal_w)} W</span>
          <span>Load {fmt(selected.load_w)} W</span>
          <span>Reserve {fmt(r.power.reserve_floor * 100, 1)}%</span>
        </div>
      )}
      <p>
        Hover or focus the graph; use arrow keys to inspect each sample. Blue: SOC nominal / dashed conservative · Amber: array · Rose: load
        (power scale 0–{fmt(maxPower, 0)} W) · horizontal dashed line: reserve
      </p>
    </div>
  );
}
function HorizonPlot({ result: r }: { result: ScienceResult }) {
  const p = r.terrain;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!p.azimuth_deg.length)
    return (
      <p className="hint">
        No terrain horizon available in this mode or at this coordinate.
      </p>
    );
  const values = p.elevation_deg.filter((v): v is number => v !== null);
  const min = Math.floor(Math.min(0, ...values)),
    max = Math.ceil(Math.max(2, ...values));
  const y = (v: number) => 14 + ((max - v) / (max - min)) * 95;
  const activeAzimuth = activeIndex === null ? undefined : p.azimuth_deg[activeIndex];
  const activeElevation = activeIndex === null ? undefined : p.elevation_deg[activeIndex];
  const activeIsBounded = activeIndex !== null && !!p.bounded_sectors?.[activeIndex];
  const nearestIndex = (azimuth: number) => p.azimuth_deg.reduce(
    (best, value, index) => Math.abs(value - azimuth) < Math.abs(p.azimuth_deg[best] - azimuth) ? index : best,
    0,
  );
  let segments: string[] = [];
  let current: string[] = [];
  p.azimuth_deg.forEach((az, i) => {
    const h = p.elevation_deg[i];
    if (h === null || !p.bounded_sectors?.[i]) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${45 + (az / 360) * 810},${y(h)}`);
  });
  if (current.length) segments.push(current.join(" "));
  return (
    <>
    <svg
      className="horizon-plot"
      viewBox="0 0 900 140"
      role="group"
      aria-label="Terrain horizon profile. Hover or focus the chart and use arrow keys to inspect sampled azimuth and elevation. Gaps are unknown."
      tabIndex={0}
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 900;
        setActiveIndex(nearestIndex(Math.max(0, Math.min(360, ((x - 45) / 810) * 360))));
      }}
      onMouseLeave={() => setActiveIndex(null)}
      onFocus={() => setActiveIndex((index) => index ?? 0)}
      onBlur={() => setActiveIndex(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((index) => Math.min(p.azimuth_deg.length - 1, (index ?? 0) + 1));
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) => Math.max(0, (index ?? 0) - 1));
        } else if (event.key === "Home") {
          event.preventDefault(); setActiveIndex(0);
        } else if (event.key === "End") {
          event.preventDefault(); setActiveIndex(p.azimuth_deg.length - 1);
        }
      }}
    >
      {[0, 90, 180, 270, 360].map((az) => (
        <g key={az}>
          <line
            x1={45 + (az / 360) * 810}
            x2={45 + (az / 360) * 810}
            y1="10"
            y2="110"
          />
          <text x={45 + (az / 360) * 810} y="129" textAnchor="middle">
            {az}°{" "}
            {az === 0 || az === 360
              ? "N"
              : az === 90
                ? "E"
                : az === 180
                  ? "S"
                  : "W"}
          </text>
        </g>
      ))}
      {[min, max].map((v) => (
        <text key={v} x="35" y={y(v) + 3} textAnchor="end">
          {v}°
        </text>
      ))}
      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points}
          stroke="#b6cbd4"
          strokeWidth="1.5"
          fill="none"
        />
      ))}
      {activeIndex !== null && activeAzimuth !== undefined && (
        <>
          <line className="horizon-cursor" x1={45 + (activeAzimuth / 360) * 810} x2={45 + (activeAzimuth / 360) * 810} y1="10" y2="110" />
          {activeIsBounded && activeElevation !== null && activeElevation !== undefined && (
            <circle className="horizon-point" cx={45 + (activeAzimuth / 360) * 810} cy={y(activeElevation)} r="4" />
          )}
        </>
      )}
    </svg>
    <div className="horizon-readout" aria-live="polite" aria-atomic="true">
      {activeIndex === null ? (
        <span>Hover over the line or focus it and use arrow keys.</span>
      ) : (
        <>
          <strong>Azimuth {fmt(activeAzimuth, 1)}°</strong>
          <span>{activeIsBounded && activeElevation !== null ? `Horizon angle ${fmt(activeElevation ?? undefined, 2)}°` : "Terrain unknown at this bearing"}</span>
        </>
      )}
    </div>
    </>
  );
}
export function CoverageTable() {
  return (
    <div className="coverage-table">
      <h3>What is computed, and what remains unqualified</h3>
      <table className="science-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Implemented screening</th>
            <th>Operational gap</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "Eclipses",
              "Apparent spherical disk overlap, direct-solar fraction",
              "Atmosphere, limb darkening and independent event-timing validation",
            ],
            [
              "Terrain visibility",
              "Native DEM ray samples, curvature, finite disks, sensitivity bands",
              "Sub-grid hazards, full uncertainty ensemble and continuous-horizon validation",
            ],
            [
              "Events",
              "Sign-change scan and ≤1 s numerical brackets",
              "Completeness for grazing / sub-step events; physical timing error",
            ],
            [
              "Station access / RF",
              "Dated ITRF93 stations, local masks, free-space Eb/N0 margin",
              "DSN booking, current masks, patterns, weather and hardware qualification",
            ],
            [
              "Power",
              "Array incidence, solar flux, eclipse loss, energy balance and reserve",
              "Thermal/degradation, detailed cell behavior and peak-current validation",
            ],
            [
              "Landing",
              "Native DEM slope/roughness screen and missing-hazard ledger",
              "Rocks, regolith, plume, navigation dispersion, landing gear and onboard HDA",
            ],
            [
              "Robots / hoppers / crew",
              "Activity load and ideal vacuum-hop feasibility",
              "Autonomous navigation, propulsion trajectory, life support and crew procedures",
            ],
          ].map(([domain, model, gap]) => (
            <tr key={domain}>
              <td>{domain}</td>
              <td>{model}</td>
              <td>{gap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function exportAnalysisCSV(r: ScienceResult, name: string) {
  const lines = [
    "# Research screening; Moon / MOON_ME; hardware assumptions are in JSON; unknown is empty, never zero",
    "utc,elapsed_hours,eclipse,solar_fraction_nominal,solar_fraction_lower,terrain_unknown,power_w,power_lower_w,load_w,soc_nominal,soc_conservative,station,station_access,station_elevation_deg,nominal_rf_margin_db",
    ...r.rows.map((x) =>
      [
        x.time,
        x.elapsed,
        x.eclipse.state,
        x.solar_fraction_nominal,
        x.solar_fraction_lower,
        x.terrain_unknown,
        x.power_nominal_w,
        x.power_lower_w,
        x.load_w,
        x.soc_nominal,
        x.soc_conservative,
        x.station.station,
        x.station.access === null ? "" : x.station.access,
        x.station.earth_station_elevation_deg,
        x.station.rf.nominal_margin_db,
      ].join(","),
    ),
  ];
  saveFile(lines.join("\n"), "text/csv", `${name}-mission-analysis.csv`);
}
