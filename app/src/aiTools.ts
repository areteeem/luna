import { scienceRequest } from "./scienceClient";
import { DEFAULT_REPORT } from "./preferences";
import { createStudy, geometryKey, isStudy, uid, newSatellite } from "./study";
import type { Geometry, MissionEvent, Study, Annotation } from "./study";
import type { WorkspaceValue } from "./WorkspaceContext";
import type { AIAction } from "./ai";
import { SCIENCE_DEFAULTS, validScience } from "./science";
export const TOOL_SCHEMAS = [
  {
    type: "open_preferences",
    section: "appearance|general|report|offline|ai|help",
  },
  {
    type: "set_appearance",
    patch:
      "{theme?:light|dark|system,appearance?:solid|glass,blur?:boolean,mapGlass?:boolean,terrainMode?:auto|terrain|image,terrainQuality?:low|balanced|high,terrainExaggeration?:1..5,adaptiveTerrain?:boolean,compact?:boolean,animations?:boolean}",
  },
  { type: "set_general_preferences", patch: "{pinchSensitivity?:0.25..3,autosaveMs?:250..10000,showHints?:boolean}" },
  { type: "set_ai_preferences", patch: "{autoApply?:boolean,allowEdits?:boolean,shareStudy?:boolean,shareResults?:boolean,allowWebBrowsing?:boolean,keepHistory?:boolean,temperature?:0..2,maxTokens?:128..12000,contextTokens?:2048..16384,keepAlive?:0|1m|5m|15m}" },
  { type: "web_search", query: "search query (max 500 characters)" },
  { type: "web_open", url: "http or https URL from search results" },
  {
    type: "set_report",
    patch:
      "subset of {title,author,pageSize:a4|letter,fontSize:8..14,accent:#RRGGBB,maps,extraViews,coordinates,mission,science,assumptions,sources,annotations,recommendations,bullets,syntax,includeComparison}; flags are booleans",
  },
  {
    type: "set_study",
    patch: {
      name: "string (max 100)",
      site: "{name,lat,lon,height}",
      compareSite: "{name,lat,lon,height}",
      start: "UTC ISO",
      compareStart: "UTC ISO",
      duration: "hours 0.0167-744",
      cursor: "hours within duration",
      active: "A|B",
      alignment: "elapsed|utc",
    },
  },
  {
    type: "set_map",
    patch: {
      view: "3d|2d|oblique",
      layer: "imagery|elevation|hillshade|slope",
      grid: "boolean",
      lighting: "boolean",
      directions: "boolean",
      stars: "boolean",
      showRecommendations: "boolean",
    },
  },
  {
    type: "set_analysis",
    patch: "subset of current analysis inputs: geometry (terrain,mast_m,height_uncertainty_m,horizon_range_km,horizon_step_deg); station link (station,station_mask_deg,frequency_ghz,tx_power_w,tx_gain_dbi,rx_diameter_m,rx_efficiency,system_noise_k,other_losses_db,bitrate_bps,required_ebno_db,implementation_loss_db,reserve_margin_db); solar and battery (panel_area_m2,panel_efficiency,panel_derating,panel_mode,panel_tilt_deg,panel_azimuth_deg,battery_wh,initial_soc,minimum_soc,charge_efficiency,discharge_efficiency,base_load_w,active_load_w); terrain screen (footprint_m,slope_limit_deg,roughness_limit_m); vehicle (vehicle,hop_dry_mass_kg,hop_propellant_kg,hop_isp_s,hop_speed_m_s,hop_angle_deg). Numeric values must respect the current validated ranges; station is DSS-14|DSS-43|DSS-63, panel_mode tracking|fixed, vehicle rover|lander|hopper|crewed",
  },
  {
    type: "add_activities",
    activities:
      "array of {name,offset(hours),duration(hours),type(landing|ascent|science|communication|traverse|power),notes}",
  },
  {
    type: "edit_activity",
    id: "existing id",
    patch: "{name?,offset?,duration?,type?,notes?,done?}",
  },
  { type: "delete_activity", id: "existing id" },
  { type: "add_tasks", tasks: "array of {title,note?}" },
  { type: "complete_task", id: "existing id", done: "boolean" },
  { type: "delete_task", id: "existing id" },
  {
    type: "add_annotation",
    annotation:
      "{kind:point|line|polygon,name,note,color:#RRGGBB,coordinates:[[east_lon,lat],...]}",
  },
  { type: "delete_annotation", id: "existing annotation id" },
  {
    type: "add_satellite",
    satellite: "{name,altitude(km),inclination,raan,phase,color:#RRGGBB}",
  },
  { type: "focus_map", lat: "degrees -90..90", lon: "east degrees -180..180" },
  { type: "map_tool", tool: "pan|site|point|line|polygon|measure" },
  { type: "zoom_map", direction: "in|out" },
  {
    type: "open_panel",
    panel: "map|inspector|explorer|mission|science|analysis|table|tasks|chat",
  },
  { type: "arrange", preset: "mapping|planning|analysis|comparison|focus" },
  {
    type: "new_project",
    name: "string",
    template: "south|apollo|farside|blank",
  },
  { type: "run_analysis" },
  { type: "recommend_sites", radius_km: "0.1-20" },
  { type: "optimize_coordinates", radius_km: "0.1-20" },
  { type: "open_help" },
  { type: "run_tour" },
  {
    type: "export_file",
    format: "pdf|json|workspace|csv|missioncsv|geojson|kml|ics|svg|png",
  },
  { type: "undo" },
  { type: "redo" },
];
export function analysisSummary(g?: Geometry) {
  const a = g?.analysis;
  return !a
    ? { available: false }
    : {
        available: true,
        terrain: a.terrain.status,
        inputs: {
          battery_wh: a.inputs.battery_wh,
          minimum_soc: a.inputs.minimum_soc,
          station: a.inputs.station,
        },
        power: a.power,
        access: a.access,
        landing: a.landing,
        events: a.events.slice(0, 30),
        candidate_windows: a.candidate_windows,
        limitations: a.limitations,
        scope: "Sampled research analysis, not flight clearance",
      };
}
export function assistantContext(
  s: Study,
  a: Geometry | undefined,
  b: Geometry | undefined,
  shareStudy: boolean,
  shareResults: boolean,
  allowWebBrowsing = true,
) {
  return {
    actions: TOOL_SCHEMAS.filter((tool) => allowWebBrowsing || !["web_search", "web_open"].includes(tool.type)),
    study: shareStudy
      ? {
          name: s.name,
          site: s.site,
          compareSite: s.compareSite,
          start: s.start,
          compareStart: s.compareStart,
          duration: s.duration,
          cursor: s.cursor,
          active: s.active,
          alignment: s.alignment,
          view: s.view,
          layer: s.layer,
          analysis: s.analysis,
          satellites: s.satellites,
          events: s.events.slice(0, 60),
          tasks: s.tasks?.slice(0, 50),
          annotations: s.annotations.slice(0, 30),
        }
      : undefined,
    calculated: shareResults
      ? { A: analysisSummary(a), B: analysisSummary(b) }
      : undefined,
  };
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
};
const pick = (value: unknown, keys: string[]) =>
  Object.fromEntries(
    Object.entries(object(value)).filter(([key]) => keys.includes(key)),
  );
export function actionsForCurrentUserTurn(
  actions: AIAction[],
  round: number,
  request = "",
): AIAction[] {
  if (round > 0) return [];
  const text = request.toLowerCase();
  const matches = (pattern: RegExp) => pattern.test(text);
  const required: AIAction[] = [];
  const explicitlyAvoids = (verb: string) =>
    matches(new RegExp(`\\b(don't|do not|never|stop)\\s+(?:please\\s+)?(?:${verb})\\b`));
  const wantsAnalysis =
    !explicitlyAvoids("run|perform|calculate|recalculate|analy[sz]e|compute") &&
    matches(/\b(run|perform|calculate|recalculate|analy[sz]e|compute)\b.{0,60}\b(analysis|mission|scenario|sunlight|battery|station|eclipse)\b|\b(analysis|mission analysis|solar energy|minimum battery|station access|sunlight window|eclipse event)\b/);
  if (wantsAnalysis) required.push({ type: "run_analysis" });
  const wantsExport =
    !explicitlyAvoids("export|download|save") &&
    matches(/\b(export|download|save)\b/) &&
    (matches(/\b(pdf|report|file|json|csv|geojson|kml|calendar|svg|png|workspace)\b/) ||
      matches(/\b(again|retry|try again|once more)\b/));
  if (wantsExport) {
    const formats = ["pdf", "json", "workspace", "csv", "geojson", "kml", "ics", "svg", "png"];
    const format = formats.find((candidate) => matches(new RegExp(`\\b${candidate}\\b`))) || "pdf";
    required.push({ type: "export_file", format });
  }
  const numericSettings: { key: keyof typeof SCIENCE_DEFAULTS; label: string; pattern: RegExp }[] = [
    { key: "battery_wh", label: "battery capacity", pattern: /\b(?:usable\s+)?battery\s+(?:capacity|size|energy)\b/ },
    { key: "initial_soc", label: "initial battery charge", pattern: /\b(?:initial|starting)\s+(?:battery\s+)?(?:state of charge|charge|soc)\b/ },
    { key: "minimum_soc", label: "minimum battery reserve", pattern: /\b(?:minimum|reserve)\s+(?:battery\s+)?(?:state of charge|reserve|soc)\b/ },
    { key: "panel_area_m2", label: "solar panel area", pattern: /\b(?:solar\s+)?panel area\b/ },
    { key: "panel_efficiency", label: "solar cell efficiency", pattern: /\b(?:solar cell|panel) efficiency\b/ },
    { key: "panel_derating", label: "solar panel derating", pattern: /\b(?:solar panel|panel) derating\b/ },
    { key: "base_load_w", label: "continuous load", pattern: /\b(?:continuous|base) load\b/ },
    { key: "active_load_w", label: "activity load", pattern: /\b(?:activity|additional|active) load\b/ },
    { key: "station_mask_deg", label: "minimum station elevation", pattern: /\b(?:minimum )?(?:ground station )?elevation (?:mask|threshold)\b|\bstation mask\b/ },
    { key: "frequency_ghz", label: "carrier frequency", pattern: /\bcarrier frequency\b/ },
    { key: "tx_power_w", label: "spacecraft transmit power", pattern: /\b(?:spacecraft )?transmit power\b/ },
    { key: "tx_gain_dbi", label: "transmit antenna gain", pattern: /\btransmit antenna gain\b/ },
    { key: "rx_diameter_m", label: "receive dish diameter", pattern: /\breceive dish diameter\b/ },
    { key: "rx_efficiency", label: "aperture efficiency", pattern: /\baperture efficiency\b/ },
    { key: "system_noise_k", label: "system noise", pattern: /\bsystem noise\b/ },
    { key: "other_losses_db", label: "path loss", pattern: /\b(?:combined )?(?:path|pointing) losses?\b/ },
    { key: "bitrate_bps", label: "information bitrate", pattern: /\b(?:information )?bitrate\b/ },
    { key: "required_ebno_db", label: "required Eb/N0", pattern: /\brequired eb\s*\/?\s*n0\b/ },
    { key: "implementation_loss_db", label: "implementation loss", pattern: /\bimplementation loss\b/ },
    { key: "reserve_margin_db", label: "design reserve", pattern: /\bdesign reserve\b/ },
    { key: "mast_m", label: "observer mast height", pattern: /\b(?:observer )?mast height\b|\bmast\b/ },
    { key: "horizon_range_km", label: "horizon radius", pattern: /\bhorizon (?:radius|range)\b/ },
    { key: "horizon_step_deg", label: "horizon sample step", pattern: /\bhorizon (?:sample )?(?:step|resolution)\b/ },
    { key: "footprint_m", label: "screening footprint radius", pattern: /\b(?:screening )?footprint radius\b/ },
    { key: "slope_limit_deg", label: "slope limit", pattern: /\bslope limit\b/ },
    { key: "roughness_limit_m", label: "roughness limit", pattern: /\b(?:residual )?roughness limit\b/ },
  ];
  for (const setting of numericSettings) {
    const match = text.match(new RegExp(`${setting.pattern.source}.{0,36}\\b(?:to|at|=)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(kwh|wh|kw|w|%|percent)?`, "i"));
    if (!match) continue;
    let value = Number(match[1].replaceAll(",", ""));
    const unit = (match[2] || "").toLowerCase();
    if (unit === "kwh" || unit === "kw") value *= 1000;
    if ((unit === "%" || unit === "percent") && ["initial_soc", "minimum_soc", "panel_efficiency", "panel_derating", "rx_efficiency"].includes(setting.key)) value /= 100;
    if (Number.isFinite(value)) {
      required.push({ type: "set_analysis", patch: { [setting.key]: value } });
      break;
    }
  }
  const view = matches(/\b(2d|two[- ]dimensional)\b/) ? "2d"
    : matches(/\b(3d|three[- ]dimensional)\b/) ? "3d"
      : matches(/\boblique\b/) ? "oblique" : null;
  if (view && matches(/\b(map|globe|view)\b/) && matches(/\b(set|change|switch|show|use)\b/))
    required.push({ type: "set_map", patch: { view } });
  if (!explicitlyAvoids("find|search|recommend|propose|compare|rank") &&
      matches(/\b(find|search|recommend|propose|compare|rank)\b.{0,60}\b(site|location|candidate|place)s?\b|\bnearby locations?\b/)) {
    const radiusMatch = text.match(/\b(?:within|radius(?: of)?)\s+(\d+(?:\.\d+)?)\s*km\b/);
    required.push({ type: "recommend_sites", radius_km: radiusMatch ? Number(radiusMatch[1]) : 2 });
  }
  const requestAllows = (action: AIAction) => {
    switch (action.type) {
      case "export_file":
        return matches(/\b(export|download|save)\b/) &&
          (matches(/\b(pdf|report|file|json|csv|geojson|kml|calendar|svg|png|workspace)\b/) || matches(/\b(again|retry|try again|once more)\b/));
      case "run_analysis":
        return matches(/\b(run|perform|calculate|recalculate|analy[sz]e|compute)\b.{0,60}\b(analysis|mission|scenario|sunlight|battery|station|eclipse)\b|\b(analysis|mission analysis|solar energy|minimum battery|station access|sunlight window|eclipse event)\b/);
      case "recommend_sites":
        return matches(/\b(find|search|recommend|propose|compare|rank)\b.{0,60}\b(site|location|candidate|place)s?\b|\bnearby locations?\b/);
      case "optimize_coordinates":
        return matches(/\b(optimi[sz]e|improve|move|relocate)\b.{0,60}\b(coordinates?|site|location|point)\b/);
      case "set_map":
        return matches(/\b(map|view|layer|coordinate grid|lighting|direction arrows)\b/) && matches(/\b(set|change|switch|turn|show|hide|enable|disable|use)\b/);
      case "set_study":
        return matches(/\b(change|set|update|move|rename|edit)\b.{0,70}\b(study|site|coordinate|latitude|longitude|start|date|duration|scenario|mission)\b/);
      case "set_analysis":
        return matches(/\b(change|set|update|adjust|configure)\b.{0,70}\b(analysis|hardware|battery|power|station|radio|solar|assumption)s?\b/);
      case "open_panel":
        return matches(/\b(open|show|go to|switch to|display)\b.{0,50}\b(panel|tab|view|map|analysis|mission|table|tasks|chat|explorer|inspector)\b/);
      case "open_preferences":
        return matches(/\b(open|show|change|update)\b.{0,50}\b(preferences|settings|report setup|AI settings|offline maps)\b/);
      case "set_report":
        return matches(/\b(change|set|update|configure)\b.{0,60}\b(report|pdf|export)\b/);
      case "set_appearance":
        return matches(/\b(change|set|update|turn|enable|disable)\b.{0,60}\b(theme|appearance|blur|animation|compact|terrain display)\b/);
      case "set_general_preferences":
        return matches(/\b(change|set|update|configure)\b.{0,60}\b(general preference|autosave|hint|pinch)\b/);
      case "set_ai_preferences":
        return matches(/\b(change|set|update|configure)\b.{0,60}\b(AI preference|AI behavior|automatic edits|chat history|context length)\b/i);
      case "add_activities": return matches(/\b(add|create|draft|schedule)\b.{0,60}\b(activity|activities|event|timeline|plan)\b/);
      case "edit_activity": return matches(/\b(edit|change|move|reschedule|rename)\b.{0,60}\b(activity|event|timeline)\b/);
      case "delete_activity": return matches(/\b(delete|remove)\b.{0,60}\b(activity|event)\b/);
      case "add_tasks": return matches(/\b(add|create)\b.{0,60}\b(task|to-do|todo)\b/);
      case "complete_task": return matches(/\b(complete|finish|mark done)\b.{0,60}\b(task|to-do|todo)\b/);
      case "delete_task": return matches(/\b(delete|remove)\b.{0,60}\b(task|to-do|todo)\b/);
      case "add_annotation": return matches(/\b(add|draw|create)\b.{0,60}\b(note|annotation|traverse|boundary|region)\b/);
      case "delete_annotation": return matches(/\b(delete|remove)\b.{0,60}\b(note|annotation|traverse|boundary|region)\b/);
      case "add_satellite": return matches(/\b(add|create|plan)\b.{0,60}\b(satellite|relay)\b/);
      case "focus_map": return matches(/\b(focus|center|go to|navigate)\b.{0,60}\b(map|site|location|coordinate|latitude|longitude)\b/);
      case "map_tool": return matches(/\b(activate|select|use|enable)\b.{0,60}\b(map tool|pan|point tool|line tool|polygon|measure)\b/);
      case "zoom_map": return matches(/\b(zoom in|zoom out)\b/);
      case "arrange": return matches(/\b(arrange|switch|change|use)\b.{0,50}\b(layout|workspace)\b/);
      case "new_project": return matches(/\b(create|start|make|open)\b.{0,50}\b(new project|new study|blank study)\b/);
      case "open_help": return matches(/\b(open|show|find|read)\b.{0,40}\b(help|guide|documentation)\b/);
      case "run_tour": return matches(/\b(start|run|begin)\b.{0,30}\b(tour|walkthrough)\b/);
      case "undo": return matches(/\bundo\b/);
      case "redo": return matches(/\bredo\b/);
      default: return false;
    }
  };
  const seen = new Set<string>();
  const requiredTypes = new Set(required.map((action) => action.type));
  return [...required, ...actions.filter((action) => !requiredTypes.has(action.type))].filter((action) => {
    if (!requestAllows(action)) return false;
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function summarizeActionResults(actions: AIAction[], rawResults: unknown): string {
  const results = Array.isArray(rawResults)
    ? (rawResults as { type?: string; status?: string; error?: string; result?: unknown; name?: string }[])
    : [];
  const number = (value: unknown, digits = 1) =>
    typeof value === "number" && Number.isFinite(value)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)
      : null;
  return actions.map((action) => {
    const failure = results.find((item) => item.type === action.type && item.status === "failed");
    if (failure) return `${action.type} failed: ${failure.error || "the app action did not complete"}.`;
    const entry = results.find((item) => item.type === action.type && item.result !== undefined);
    const data = entry?.result && typeof entry.result === "object"
      ? entry.result as Record<string, unknown>
      : undefined;
    if (action.type === "run_analysis" && data) {
      if (data.available !== true) return "Mission analysis did not return a usable result. Check the selected scenario and try again.";
      const power = data.power as Record<string, unknown> | undefined;
      const access = data.access as Record<string, unknown> | undefined;
      const inputs = data.inputs as Record<string, unknown> | undefined;
      const batteryWh = typeof inputs?.battery_wh === "number" ? inputs.battery_wh : null;
      const nominalSoc = typeof power?.minimum_soc_nominal === "number" ? power.minimum_soc_nominal : null;
      const conservativeSoc = typeof power?.minimum_soc_conservative === "number" ? power.minimum_soc_conservative : null;
      const batteryText = nominalSoc === null
        ? "Minimum battery state was unavailable"
        : `minimum battery state was ${number(nominalSoc * 100)}% nominal${conservativeSoc === null ? "" : ` / ${number(conservativeSoc * 100)}% conservative`}${batteryWh === null ? "" : ` (about ${number(nominalSoc * batteryWh)} Wh nominal remaining)`}`;
      const generation = number(power?.generated_nominal_wh);
      const station = typeof access?.station === "string" ? access.station : String(inputs?.station || "selected station");
      const accessHours = number(access?.available_hours_at_samples, 2);
      const unknownHours = number(access?.unknown_terrain_hours, 2);
      const sunlightText = generation === null ? "solar energy estimate unavailable" : `nominal solar energy generated was ${generation} Wh`;
      const stationText = accessHours === null ? `station access for ${station} was unavailable` : `sampled ${station} access was ${accessHours} h`;
      const terrainText = unknownHours === null ? "" : `; terrain-dependent access was unknown for ${unknownHours} h`;
      return `Mission analysis completed. ${sunlightText}; ${batteryText}; ${stationText}${terrainText}. These are sampled research estimates, not flight or landing clearance.`;
    }
    if (action.type === "export_file") {
      const format = String(action.format || "file").toUpperCase();
      return format === "PDF"
        ? "The PDF report was exported with its required site image and mission geometry figure."
        : `The ${format} report was exported.`;
    }
    if (action.type === "set_map") {
      const view = action.patch && typeof action.patch === "object"
        ? (action.patch as Record<string, unknown>).view
        : undefined;
      return typeof view === "string" ? `Map view changed to ${view.toUpperCase()}.` : "Map settings were updated.";
    }
    if (action.type === "set_analysis") {
      const patch = action.patch && typeof action.patch === "object"
        ? action.patch as Record<string, unknown>
        : {};
      const labels: Record<string, string> = {
        battery_wh: "usable battery capacity",
        minimum_soc: "minimum battery reserve",
        initial_soc: "initial battery charge",
        panel_area_m2: "solar panel area",
        panel_efficiency: "solar cell efficiency",
        panel_derating: "solar panel derating",
        base_load_w: "continuous load",
        active_load_w: "activity load",
      };
      const changes = Object.entries(patch).map(([key, value]) => {
        const label = labels[key] || key.replaceAll("_", " ");
        const formatted = typeof value === "number" ? number(value, 3) : String(value);
        const unit = key === "battery_wh" ? " Wh" : key.endsWith("_w") ? " W" : key === "panel_area_m2" ? " m²" : "";
        return `${label}: ${formatted}${unit}`;
      });
      return changes.length ? `Analysis settings updated: ${changes.join("; ")}.` : "Analysis settings updated.";
    }
    const completed = results.some((item) => item.type === action.type && (item.status === "complete" || item.status === "created" || item.result !== undefined));
    if (action.type === "new_project") {
      const project = results.find((item) => item.type === action.type && item.status === "created");
      return project ? `Created project “${project.name || action.name || "AI study"}”.` : "The project action did not return a confirmation.";
    }
    return completed ? `${action.type.replaceAll("_", " ")} completed.` : `${action.type.replaceAll("_", " ")} was not confirmed as complete.`;
  }).join(" ");
}
export async function executeActions(
  actions: AIAction[],
  w: WorkspaceValue,
  initial: Study,
  onLog: (message: string) => void,
) {
  if (
    w.study.id !== initial.id ||
    JSON.stringify(w.study) !== JSON.stringify(initial)
  )
    throw new Error(
      "Study changed since this proposal. Ask for an updated proposal before applying it.",
    );
  let current = structuredClone(initial);
  let preferences = structuredClone(w.preferences);
  const results: unknown[] = [];
  const apply = (patch: Partial<Study>) => {
    const next = { ...current, ...patch };
    if (!isStudy(next))
      throw new Error(
        "Action rejected: invalid coordinates, time, hardware or document structure",
      );
    current = next;
    w.update(patch);
  };
  for (const action of actions.slice(0, 32)) {
    onLog("Running " + action.type);
    try {
      switch (action.type) {
        case "open_preferences": {
          const section = String(action.section).toLowerCase().replace(/[ _-]+/g, "");
          const aliases: Record<string, string> = {
            appearance: "appearance", theme: "appearance", design: "appearance",
            general: "general", preferences: "general", report: "report", pdf: "report",
            offline: "offline", offlinemaps: "offline", ai: "ai", models: "ai", aimodels: "ai",
            help: "help", about: "help",
          };
          const target = aliases[section];
          if (!target) throw new Error(`Unknown preference section: ${String(action.section)}`);
          w.openPreferences(target);
          break;
        }
        case "open_help":
          w.openHelp();
          break;
        case "run_tour":
          w.runTour();
          break;
        case "set_appearance": {
          const patch = pick(action.patch, [
            "theme",
            "appearance",
            "blur",
            "mapGlass",
            "terrainMode", "terrainQuality", "terrainExaggeration", "adaptiveTerrain",
            "compact",
            "animations",
          ]);
          if (
            (patch.theme !== undefined &&
              !["light", "dark", "system"].includes(String(patch.theme))) ||
            (patch.appearance !== undefined &&
              !["solid", "glass"].includes(String(patch.appearance))) ||
            (patch.terrainMode !== undefined && !["auto", "terrain", "image"].includes(String(patch.terrainMode))) ||
            (patch.terrainQuality !== undefined && !["low", "balanced", "high"].includes(String(patch.terrainQuality))) ||
            (patch.terrainExaggeration !== undefined && (!Number.isFinite(patch.terrainExaggeration) || Number(patch.terrainExaggeration) < 1 || Number(patch.terrainExaggeration) > 5)) ||
            ["blur", "mapGlass", "adaptiveTerrain", "compact", "animations"].some(
              (k) => patch[k] !== undefined && typeof patch[k] !== "boolean",
            )
          )
            throw new Error("Invalid appearance preference");
          preferences = { ...preferences, ...patch };
          w.setPreferences(preferences);
          break;
        }
        case "set_general_preferences": {
          const patch = pick(action.patch, ["pinchSensitivity", "autosaveMs", "showHints"]);
          if (
            (patch.pinchSensitivity !== undefined &&
              (!Number.isFinite(patch.pinchSensitivity) || Number(patch.pinchSensitivity) < 0.25 || Number(patch.pinchSensitivity) > 3)) ||
            (patch.autosaveMs !== undefined &&
              (!Number.isFinite(patch.autosaveMs) || Number(patch.autosaveMs) < 250 || Number(patch.autosaveMs) > 10000)) ||
            (patch.showHints !== undefined && typeof patch.showHints !== "boolean")
          ) throw new Error("Invalid general preference");
          w.setPreferences({ ...preferences, ...patch });
          preferences = { ...preferences, ...patch };
          break;
        }
        case "set_ai_preferences": {
          const patch = pick(action.patch, ["autoApply", "allowEdits", "shareStudy", "shareResults", "allowWebBrowsing", "keepHistory", "temperature", "maxTokens", "contextTokens", "keepAlive"]);
          if (
            ["autoApply", "allowEdits", "shareStudy", "shareResults", "allowWebBrowsing", "keepHistory"].some((key) => patch[key] !== undefined && typeof patch[key] !== "boolean") ||
            (patch.temperature !== undefined && (!Number.isFinite(patch.temperature) || Number(patch.temperature) < 0 || Number(patch.temperature) > 2)) ||
            (patch.maxTokens !== undefined && (!Number.isInteger(patch.maxTokens) || Number(patch.maxTokens) < 128 || Number(patch.maxTokens) > 12000)) ||
            (patch.contextTokens !== undefined && (!Number.isInteger(patch.contextTokens) || Number(patch.contextTokens) < 2048 || Number(patch.contextTokens) > 16384)) ||
            (patch.keepAlive !== undefined && !["0", "1m", "5m", "15m"].includes(String(patch.keepAlive)))
          ) throw new Error("Invalid AI preference");
          preferences = { ...preferences, ai: { ...preferences.ai, ...patch } };
          w.setPreferences(preferences);
          break;
        }
        case "set_report": {
          const patch = pick(action.patch, Object.keys(DEFAULT_REPORT));
          const report = { ...preferences.report, ...patch, maps: true };
          if (
            !["a4", "letter"].includes(report.pageSize) ||
            !Number.isFinite(report.fontSize) ||
            report.fontSize < 8 ||
            report.fontSize > 14 ||
            !/^#[0-9a-f]{6}$/i.test(report.accent) ||
            typeof report.title !== "string" ||
            report.title.length > 120 ||
            typeof report.author !== "string" ||
            report.author.length > 120 ||
            Object.entries(DEFAULT_REPORT).some(
              ([k, v]) =>
                typeof v === "boolean" &&
                typeof report[k as keyof typeof report] !== "boolean",
            )
          )
            throw new Error("Invalid report preference");
          preferences = { ...preferences, report };
          w.setPreferences(preferences);
          break;
        }
        case "set_study":
          apply(
            pick(action.patch, [
              "name",
              "site",
              "compareSite",
              "start",
              "compareStart",
              "duration",
              "cursor",
              "active",
              "alignment",
            ]),
          );
          break;
        case "set_map":
          apply(
            pick(action.patch, [
              "view",
              "layer",
              "grid",
              "lighting",
              "directions",
              "stars",
              "showRecommendations",
            ]),
          );
          break;
        case "set_analysis": {
          const patch = object(action.patch);
          const keys = Object.keys(SCIENCE_DEFAULTS);
          if (Object.keys(patch).some((key) => !keys.includes(key)))
            throw new Error("Analysis proposal contains an unsupported setting");
          const analysis = { ...SCIENCE_DEFAULTS, ...current.analysis, ...patch, enabled: true };
          if (!validScience(analysis))
            throw new Error("Analysis proposal is outside the supported setting ranges or has inconsistent battery reserves");
          apply({ analysis });
          break;
        }
        case "add_activities": {
          if (
            !Array.isArray(action.activities) ||
            action.activities.length > 50
          )
            throw new Error("At most 50 activity additions");
          const events = action.activities.map((value) => {
            const e = object(value);
            return {
              id: uid(),
              name: e.name,
              offset: e.offset,
              duration: e.duration,
              type: e.type,
              notes: e.notes || "",
              done: false,
            } as MissionEvent;
          });
          apply({ events: [...current.events, ...events] });
          break;
        }
        case "edit_activity": {
          if (!current.events.some((e) => e.id === action.id))
            throw new Error("Unknown activity");
          const patch = pick(action.patch, [
            "name",
            "offset",
            "duration",
            "type",
            "notes",
            "done",
          ]);
          apply({
            events: current.events.map((e) =>
              e.id === action.id ? { ...e, ...patch } : e,
            ),
          });
          break;
        }
        case "delete_activity": {
          if (!current.events.some((event) => event.id === action.id))
            throw new Error("Unknown activity");
          apply({ events: current.events.filter((event) => event.id !== action.id) });
          break;
        }
        case "add_tasks": {
          if (!Array.isArray(action.tasks) || action.tasks.length > 50)
            throw new Error("At most 50 task additions");
          apply({
            tasks: [
              ...(current.tasks || []),
              ...action.tasks.map((t) => {
                const value = object(t);
                return {
                  id: uid(),
                  title: String(value.title || "").slice(0, 200),
                  note: String(value.note || "").slice(0, 5000),
                  done: false,
                };
              }),
            ],
          });
          break;
        }
        case "complete_task":
          if (!current.tasks?.some((task) => task.id === action.id))
            throw new Error("Unknown task");
          apply({
            tasks: current.tasks?.map((t) =>
              t.id === action.id ? { ...t, done: action.done === true } : t,
            ),
          });
          break;
        case "delete_task": {
          if (!current.tasks?.some((task) => task.id === action.id))
            throw new Error("Unknown task");
          apply({ tasks: current.tasks.filter((task) => task.id !== action.id) });
          break;
        }
        case "add_annotation":
          apply({
            annotations: [
              ...current.annotations,
              { ...object(action.annotation), id: uid() } as Annotation,
            ],
          });
          break;
        case "delete_annotation": {
          if (!current.annotations.some((annotation) => annotation.id === action.id))
            throw new Error("Unknown annotation");
          apply({ annotations: current.annotations.filter((annotation) => annotation.id !== action.id) });
          break;
        }
        case "add_satellite":
          apply({
            satellites: [
              ...current.satellites,
              {
                ...newSatellite(current.satellites.length),
                ...object(action.satellite),
                id: uid(),
                visible: true,
              } as Study["satellites"][number],
            ],
          });
          break;
        case "focus_map": {
          const lat = Number(action.lat),
            lon = Number(action.lon);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            Math.abs(lat) > 90 ||
            Math.abs(lon) > 180
          )
            throw new Error("Invalid map coordinate");
          w.showPanel("map");
          w.mapActions.current?.focus(lon, lat);
          break;
        }
        case "zoom_map":
          if (!["in", "out"].includes(String(action.direction)))
            throw new Error("Invalid zoom direction");
          w.mapActions.current?.zoom(action.direction === "in");
          break;
        case "map_tool":
          if (
            !["pan", "site", "point", "line", "polygon", "measure"].includes(
              String(action.tool),
            )
          )
            throw new Error("Invalid map tool");
          w.showPanel("map");
          w.setTool(action.tool as "pan");
          break;
        case "open_panel":
          if (
            ![
              "map",
              "inspector",
              "explorer",
              "mission",
              "science",
              "analysis",
              "table",
              "tasks",
              "chat",
            ].includes(String(action.panel))
          )
            throw new Error("Unknown panel");
          w.showPanel(String(action.panel));
          break;
        case "arrange":
          if (
            ![
              "mapping",
              "planning",
              "analysis",
              "comparison",
              "focus",
            ].includes(String(action.preset))
          )
            throw new Error("Unknown layout");
          w.arrangeLayout(String(action.preset));
          break;
        case "new_project": {
          const s = createStudy(
            ["south", "apollo", "farside", "blank"].includes(
              String(action.template),
            )
              ? String(action.template)
              : "blank",
          );
          s.name = String(action.name || "AI study").slice(0, 100);
          w.addStudy(s);
          results.push({ type: action.type, status: "created", name: s.name });
          onLog(
            "Created project; remaining actions stop to avoid editing the prior project",
          );
          return { study: current, results };
        }
        case "run_analysis": {
          apply({
            analysis: {
              ...SCIENCE_DEFAULTS,
              ...current.analysis,
              enabled: true,
            },
          });
          const response = await scienceRequest("/api/geometry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: geometryKey(current, current.active),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          results.push({ type: action.type, result: analysisSummary(data) });
          break;
        }
        case "recommend_sites": {
          const radius = Number(action.radius_km ?? 2);
          if (!Number.isFinite(radius) || radius < 0.1 || radius > 20)
            throw new Error("Search radius must be 0.1-20 km");
          const response = await scienceRequest("/api/recommendations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...JSON.parse(geometryKey(current, current.active)),
              analysis: {
                ...SCIENCE_DEFAULTS,
                ...current.analysis,
                enabled: true,
              },
              radius_km: radius,
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          data.fingerprint = geometryKey(current, current.active);
          apply({ siteSearch: data, showRecommendations: true });
          results.push({ type: action.type, result: data });
          break;
        }
        case "optimize_coordinates": {
          const radius = Number(action.radius_km ?? 2);
          if (!Number.isFinite(radius) || radius < 0.1 || radius > 20)
            throw new Error("Search radius must be 0.1-20 km");
          const response = await scienceRequest("/api/recommendations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...JSON.parse(geometryKey(current, current.active)),
              analysis: { ...SCIENCE_DEFAULTS, ...current.analysis, enabled: true },
              radius_km: radius,
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          data.fingerprint = geometryKey(current, current.active);
          const candidate = data.candidates?.find((site: {
            energy_wh?: number | null;
            delta_energy_wh?: number | null;
            landing?: { status?: string };
          }) => site.energy_wh != null && (site.delta_energy_wh || 0) > 0 && site.landing?.status !== "screen-exceeds-threshold");
          const patch: Partial<Study> = { siteSearch: data, showRecommendations: true };
          if (candidate) {
            const site = {
              name: `Modeled solar candidate ${candidate.id}`,
              lat: candidate.lat,
              lon: candidate.lon,
              height: candidate.ground_m ?? 0,
            };
            if (current.active === "A") patch.site = site;
            else patch.compareSite = site;
          }
          apply(patch);
          w.showPanel("map");
          results.push({
            type: action.type,
            status: candidate ? "updated" : "no-established-improvement",
            candidate: candidate || null,
            limits: data.limits,
          });
          break;
        }
        case "export_file":
          if (
            ![
              "pdf",
              "json",
              "workspace",
              "csv",
              "missioncsv",
              "geojson",
              "kml",
              "ics",
              "svg",
              "png",
            ].includes(String(action.format))
          )
            throw new Error("Unknown export format");
          await w.exportFile(String(action.format));
          break;
        case "undo":
          w.undo(false);
          break;
        case "redo":
          w.undo(true);
          break;
        default:
          throw new Error(
            "Unknown action type; no arbitrary execution is allowed",
          );
      }
      results.push({ type: action.type, status: "complete" });
      onLog("Completed " + action.type);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ type: action.type, status: "failed", error: message });
      onLog("Failed " + action.type + ": " + message);
    }
  }
  return { study: current, results };
}
