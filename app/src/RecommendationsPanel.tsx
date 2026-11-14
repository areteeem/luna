import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { geometryKey, activeSite } from "./study";
import { SCIENCE_DEFAULTS } from "./science";
import { aiAPI } from "./ai";
import { validSiteSearch, type SiteCandidate } from "./recommendations";

type Review = { text: string; error?: boolean };

function terrainSummary(candidate: SiteCandidate) {
  if (candidate.coverage.includes("local DEM not evaluated")) return "Not evaluated";
  if ((candidate.terrain_unknown_hours ?? 0) > 1e-7) return "Incomplete coverage";
  switch (candidate.landing.status) {
    case "screen-exceeds-threshold": return "Above terrain limits";
    case "screen-within-threshold": return "Within terrain limits";
    case "unassessed": return "Not assessed";
    default: return candidate.landing.status.replaceAll("-", " ");
  }
}
function measuredPassingSite(candidate: SiteCandidate) {
  return (candidate.terrain_unknown_hours ?? 0) <= 1e-7 &&
    candidate.meets_sun_contact_thresholds === true &&
    candidate.station_access_hours !== null &&
    candidate.joint_sun_station_hours !== null &&
    candidate.landing.status === "screen-within-threshold";
}

export function RecommendationsPanel() {
  const w = useWorkspace(), s = w.study;
  const [radius, setRadius] = useState(2),
    [areaScope, setAreaScope] = useState<"moon" | "radius" | "region" | null>(null),
    [regionId, setRegionId] = useState(""),
    [candidateView, setCandidateView] = useState<"cards" | "table">("table"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewing, setReviewing] = useState<string | null>(null),
    [reviews, setReviews] = useState<Record<string, Review>>({});
  const regions = s.annotations.filter(annotation => annotation.kind === "polygon");
  const selectedRegion = regions.find(annotation => annotation.id === w.selectedAnnotation);
  const region = regions.find(annotation => annotation.id === regionId) ?? selectedRegion ?? regions[0];
  const scope = areaScope ?? (selectedRegion ? "region" : "moon");
  const details = useRef<HTMLDetailsElement>(null);
  const fingerprint = geometryKey(s,s.active);
  const scanKey = JSON.stringify([s.id,fingerprint,scope,radius,region?.id,region?.coordinates]);
  const activeScan = useRef<AbortController | null>(null);
  useEffect(() => () => activeScan.current?.abort(),[scanKey]);
  useEffect(() => {
    if (details.current && selectedRegion) details.current.open = true;
  },[selectedRegion?.id]);
  const search = s.siteSearch;
  const searchedRegion = regions.find(annotation => annotation.id === search?.region_id);
  const regionChanged = search?.area_scope === "region" && (!searchedRegion
    || JSON.stringify(searchedRegion.coordinates) !== JSON.stringify(search.region));
  const visibleMissionStart = (regionChanged ? [] : search?.same_date_candidates || []).filter(measuredPassingSite);
  const visibleDateCandidates = (regionChanged ? [] : search?.date_candidates || []).filter(measuredPassingSite);
  const run = async () => {
    const controller = new AbortController();
    activeScan.current?.abort();
    activeScan.current = controller;
    setBusy(true); setError(""); setReviews({});
    try {
      const payload = JSON.parse(fingerprint);
      const response = await fetch("/api/recommendations", {
        method: "POST", signal:controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, area_scope: scope, radius_km: radius,
          ...(scope === "region" && region ? {region:region.coordinates,region_id:region.id} : {}), analysis: { ...SCIENCE_DEFAULTS, ...s.analysis, enabled: true } }),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error);
      if (data.version !== "sun-station-dates-v7") throw new Error("The local calculation service is running an older search version. Restart it so uncovered points stay hidden and only candidates passing the configured screens are saved.");
      if (scope === "region" && (data.area_scope !== "region" || !Array.isArray(data.region_windows))) throw new Error("Restart the local calculation service to enable region searches.");
      if (!validSiteSearch(data)) throw new Error("The calculation returned results that this study cannot save. The old results are still shown. Check that the local service and app use the same version.");
      data.fingerprint = fingerprint;
      w.update({ siteSearch: data, showRecommendations: true });
        w.notify(`Search complete. Screened ${data.same_date_screened_count ?? 0} mission-start points; ${data.same_date_candidates?.length ?? 0} meet all configured mission-start screens.`);
    } catch (e) { if (!controller.signal.aborted) setError(String(e)); }
    finally {
      if (activeScan.current === controller) {
        activeScan.current = null;
        setBusy(false);
      }
    }
  };

  const reviewTerrain = async (candidate: SiteCandidate) => {
    const key = candidate.id;
    setReviewing(key); setReviews((old) => ({ ...old, [key]: { text: "Capturing NASA terrain layers for local image review…" } }));
    try {
      const ai = w.preferences.ai;
      if (ai.provider !== "ollama" || !ai.model) {
        w.openPreferences("ai");
        throw new Error("Select and connect an Ollama model in Preferences → AI & models. The image review uses Ollama on this device only.");
      }
      const captures = await w.mapActions.current?.captureViews(
        { lat: candidate.lat, lon: candidate.lon }, ["hillshade", "elevation"],
      );
      if (!captures?.length) throw new Error("Open the lunar map once, then retry the image capture.");
      const result = await aiAPI<{ review: string }>("terrain-review", {
        model: ai.model,
        images: captures.map((capture) => ({ label: capture.label, data: capture.image })),
        site: {
          name: key,
          latitude: candidate.lat,
          longitude: candidate.lon,
          distance_km: candidate.distance_km,
          start_utc: candidate.start || search?.start,
          duration_hours: search?.duration,
          solar_hours: candidate.solar_hours,
          delta_energy_wh: candidate.delta_energy_wh,
          terrain_coverage: candidate.coverage,
          slope_deg: candidate.landing.slope_deg ?? null,
          roughness_rms_m: candidate.landing.roughness_rms_m ?? null,
          map_layers: captures.map((capture) => capture.label.split(" - ")[0]),
        },
      });
      setReviews((old) => ({ ...old, [key]: { text: result.review } }));
    } catch (e) {
      setReviews((old) => ({ ...old, [key]: { text: String(e instanceof Error ? e.message : e), error: true } }));
    } finally { setReviewing(null); }
  };

  const useCandidate = (candidate: SiteCandidate) => {
    const point = { name: `Screened site ${candidate.lat.toFixed(2)}°, ${candidate.lon.toFixed(2)}°`, lat: candidate.lat, lon: candidate.lon, height: candidate.ground_m ?? 0 };
    w.update(s.active === "A" ? { site: point, ...(candidate.start ? { start: candidate.start } : {}) } : { compareSite: point, ...(candidate.start ? { compareStart: candidate.start } : {}) });
    w.notify(`Applied ${candidate.lat.toFixed(3)}°, ${candidate.lon.toFixed(3)}° and ${candidate.start || search?.start || "the mission start"}. Mission analysis is recalculating.`);
    w.mapActions.current?.focus(candidate.lon, candidate.lat);
  };
  const showCandidate = (candidate: SiteCandidate) => {
    w.mapActions.current?.focus(candidate.lon, candidate.lat); w.showPanel("map");
  };
  const CandidateCard = ({ candidate, label }: { candidate: SiteCandidate; label?: string }) => {
    const unknownHours = candidate.terrain_unknown_hours ?? 0,
      review = reviews[candidate.id],
      solarHours = candidate.solar_hours ?? candidate.reference_solar_hours,
      energyDelta = candidate.delta_energy_wh ?? candidate.reference_delta_energy_wh,
      referenceOnly = candidate.delta_energy_wh === null && candidate.reference_delta_energy_wh !== undefined;
    return <article>
      {label && <span className="eyebrow">{label}</span>}
      <strong>{unknownHours > 1e-7
        ? "Reference-plane estimate · terrain incomplete"
        : candidate.better_sunlight
          ? "More modeled solar energy"
          : candidate.energy_wh === null ? "Solar result unavailable" : "No modeled solar gain"}</strong>
      {candidate.meets_sun_contact_thresholds !== undefined && <p>{candidate.meets_sun_contact_thresholds ? "Meets sunlight and contact screening thresholds" : "Below sunlight/contact thresholds at the mission start"}</p>}
      {unknownHours > 1e-7 && <p className="warning">This point uses reference-surface screening. Applying it can leave station access and terrain-dependent event times unknown.</p>}
      {candidate.start && <p><strong>Start: {new Date(candidate.start).toLocaleString()} (local time)</strong>{candidate.days_from_today !== undefined ? ` · ${candidate.days_from_today === 0 ? "today" : `${candidate.days_from_today} UTC days from today`}` : " · mission start"}</p>}
      <p>{candidate.lat.toFixed(5)}°, {candidate.lon.toFixed(5)}° E · {candidate.distance_km.toFixed(0)} km from this point</p>
      <p>{solarHours === null || solarHours === undefined ? "Solar duration unknown" : `${solarHours.toFixed(2)} equivalent full-sun h${referenceOnly ? " · reference-plane estimate" : ""}`} · {energyDelta === null || energyDelta === undefined ? "Gain unknown" : `${energyDelta >= 0 ? "+" : ""}${energyDelta.toFixed(1)} Wh${referenceOnly ? " estimated" : ""} vs origin`}</p>
      {candidate.station && <p>{candidate.station} contact: {(candidate.station_access_hours ?? candidate.reference_station_access_hours ?? 0).toFixed(2)} h · sunlight + contact together: {(candidate.joint_sun_station_hours ?? candidate.reference_joint_sun_station_hours ?? 0).toFixed(2)} h{candidate.station_access_hours === null || candidate.joint_sun_station_hours === null ? " · reference-plane estimate" : ""}. Includes nominal RF margin ≥ 0 dB.</p>}
      <p title="Preliminary terrain screen only; it is not a landing-clearance decision.">Terrain screen: {terrainSummary(candidate)}{candidate.landing.slope_deg === undefined ? "" : ` · slope ${candidate.landing.slope_deg.toFixed(2)}°`}</p>
      {unknownHours > 1e-7 && <p className="hint">Horizon known for {Math.max(0, candidate.known_terrain_hours).toFixed(1)} of {(search?.duration || 0).toFixed(1)} h. Unknown intervals use a reference-plane estimate; local shadows are not measured.</p>}
      {candidate.search_resolution && <p className="hint">{candidate.search_resolution}</p>}
      <div className="candidate-actions">
        <button onClick={() => useCandidate(candidate)}>Study this point</button>
        <button onClick={() => showCandidate(candidate)}>Show on map</button>
        <button disabled={reviewing === candidate.id} onClick={() => void reviewTerrain(candidate)}>{reviewing === candidate.id ? "Reviewing locally…" : "Review terrain images with on-device AI"}</button>
      </div>
      {review && <div className={`site-ai-review ${review.error ? "error" : ""}`}><strong>Qualitative image review · local AI</strong><p>{review.text}</p><small>Visual cues only. Confirm slope, hazards, and horizon against numerical DEM data; this is not a landing assessment.</small></div>}
    </article>;
  };
  const CandidateResults = ({ candidates, labels }: { candidates: SiteCandidate[]; labels: string[] }) => {
    const hasTerrainAssessment = candidates.some((candidate) =>
      !candidate.coverage.includes("local DEM not evaluated") &&
      (candidate.terrain_unknown_hours ?? 0) <= 1e-7 &&
      candidate.landing.status !== "not-screened",
    );
    return candidateView === "cards"
      ? <div className="site-candidates">{candidates.map((candidate, index) => <CandidateCard key={candidate.id} candidate={candidate} label={labels[index]} />)}</div>
      : <div className="site-results-table-wrap"><table className="site-results-table"><thead><tr><th>Result</th><th>Start (UTC)</th><th>Location</th><th>Sunlight (h)</th><th>Station access (h)</th><th>Both (h)</th>{hasTerrainAssessment && <th>Terrain screen</th>}<th>Actions</th></tr></thead><tbody>{candidates.map((candidate, index) => {
      const estimate = (candidate.terrain_unknown_hours ?? 0) > 1e-7;
      const hour = (value: number | null | undefined) => `${estimate ? "~" : ""}${(value ?? 0).toFixed(1)}`;
      const estimateTitle = estimate ? "Reference-plane estimate because terrain data are incomplete" : "Calculated with available terrain data";
      return <tr key={candidate.id}>
        <td>{labels[index]}</td>
        <td>{candidate.start || search?.start || "—"}</td>
        <td>{candidate.lat.toFixed(3)}°, {candidate.lon.toFixed(3)}° E</td>
        <td title={estimateTitle}>{hour(candidate.solar_hours ?? candidate.reference_solar_hours)}</td>
        <td title={estimateTitle}>{hour(candidate.station_access_hours ?? candidate.reference_station_access_hours)}</td>
        <td title={estimateTitle}>{hour(candidate.joint_sun_station_hours ?? candidate.reference_joint_sun_station_hours)}</td>
        {hasTerrainAssessment && <td title="Preliminary DEM terrain screen, not landing clearance">{terrainSummary(candidate)}</td>}
        <td><button onClick={() => useCandidate(candidate)}>Use</button> <button onClick={() => showCandidate(candidate)}>Map</button></td>
      </tr>;
      })}</tbody></table></div>;
  };

  return <details className="section recommendations-panel" ref={details}>
    <summary>Find candidate sites</summary>
    <div className="section-content">
      <p className="recommendation-lede">Find landing candidates and study windows within a drawn region, near the current site, or across the Moon.</p>
      <div className="field-pair">
        <label className="field">Search area<select aria-label="Search area" value={scope} onChange={(e) => {
          setAreaScope(e.target.value as "moon" | "radius" | "region");
          if (region) setRegionId(region.id);
        }}><option value="moon">Whole Moon</option><option value="radius">Around current site</option><option value="region">Study region</option></select></label>
        {scope === "region" && (region ? <label className="field">Study region<select aria-label="Study region" value={region.id}
          onChange={e => setRegionId(e.target.value)}>{regions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          : <button onClick={() => { w.setTool("polygon"); w.showPanel("map"); }}>Draw a study region</button>)}
        {scope === "radius" && <label className="field">Radius (km)<input type="number" min="0.1" max="20" step="0.1" value={radius} onChange={(e) => setRadius(Math.max(0.1, Math.min(20, Number(e.target.value))))} /></label>}
        <button className="primary" disabled={busy || (scope === "region" && !region)} onClick={run}>{busy ? "Scanning the selected area and dates…" : "Scan locations and dates"}</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {search && <>
        <div className="candidate-view-switch" role="group" aria-label="Candidate display"><button aria-label="Show candidate cards" title="Cards" aria-pressed={candidateView === "cards"} onClick={() => setCandidateView("cards")}>Cards</button><button aria-label="Show candidate table" title="Table" aria-pressed={candidateView === "table"} onClick={() => setCandidateView("table")}>Table</button></div>
        <label className="check-row"><input type="checkbox" checked={!!s.showRecommendations} onChange={(e) => w.update({ showRecommendations: e.target.checked })} />Show candidates on map</label>
        {(regionChanged || (search.fingerprint && search.fingerprint !== geometryKey(s, s.active))) && <p className="warning">Study inputs changed. Rerun the search before using these comparisons.</p>}
        <p className="search-result-summary">Screen origin {search.baseline.lat.toFixed(2)}°, {search.baseline.lon.toFixed(2)}° · {search.duration} h.{search.start !== (s.active === "A" ? s.start : s.compareStart) || search.baseline.lat !== activeSite(s).lat || search.baseline.lon !== activeSite(s).lon ? " Study changed · rerun to refresh." : ""}</p>
        {search.area_scope === "region" && <section>
          <h3>Best sampled windows for the region</h3>
          <p className="hint">Ranked by how many locations pass the sunlight and station-contact thresholds. Each window spans {search.duration} h. Landing suitability is assessed separately below.</p>
          {search.region_windows?.length ? <ul>{search.region_windows.map(window => <li key={window.start}>
            <strong>{window.start}</strong> · {window.passing}/{window.sampled} pass · {window.known}/{window.sampled} assessed
            · {window.mean_sun_hours.toFixed(1)} h mean sunlight · {window.mean_joint_hours.toFixed(1)} h mean overlap
            <button disabled={regionChanged} onClick={() => w.update(s.active === "A" ? {start:window.start} : {compareStart:window.start})}>Use start</button>
          </li>)}</ul> : <p>No sampled window had measured sunlight and station contact coverage in this region.</p>}
        </section>}
        <h3>Mission-start locations that pass all screens</h3>
        {search.version === "sun-station-dates-v7" ? <>
          <p className="screening-summary">{search.area_scope === "region" ? (searchedRegion?.name || "Study region") : search.area_scope === "radius" ? `Within ${search.radius_km} km` : `Whole Moon · ${search.global_spacing_deg}° grid`} · {search.same_date_screened_count ?? 0} screened · {visibleMissionStart.length} qualify</p>
          {visibleMissionStart.length
            ? <CandidateResults candidates={visibleMissionStart} labels={visibleMissionStart.map((_, index) => `Qualified ${index + 1}`)} />
            : <p>No location passed all configured mission-start checks on measured terrain. Points without terrain coverage are hidden until data are available.</p>}
          {(search.same_date_terrain_check_count ?? 0) > 0 && <p className="hint">Terrain checks attempted: {search.same_date_terrain_check_count}; measured coverage: {search.same_date_terrain_assessed_count ?? 0}; without coverage: {search.same_date_terrain_unassessed_count ?? 0}. Uncovered coordinates are omitted.</p>}
          <h3>Earliest location and date alternatives</h3>
          <p className="hint">Nearest different dates · {visibleDateCandidates.length} alternatives</p>
          {!!visibleDateCandidates.length ? <>
            <CandidateResults candidates={visibleDateCandidates} labels={visibleDateCandidates.map((_, index) => index === 0 ? "Closest qualifying sampled start to today" : `Alternative ${index + 1}`)} />
          </> : <p>No date-and-location pair passed the sunlight, contact and measured-terrain screens in the searched window. This is a finite sampled search; try another station, mission duration or hardware configuration.</p>}
        </> : <p className="warning">These are older saved results. Click <strong>Find locations + earliest working dates</strong> to calculate sunlight, station access and the earliest dates together.</p>}
      </>}
      <p className="hint">Image review needs a vision-capable local Ollama model. LUNA captures LOLA hillshade and elevation map layers and sends them only to Ollama on this device. Image interpretation is qualitative; numeric terrain and landing checks remain separate.</p>
    </div>
  </details>;
}
