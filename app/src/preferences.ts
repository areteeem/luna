import { hosted } from "./runtime";
import { DEFAULT_AI } from "./ai";
import type { AISettings } from "./ai";
export type ReportOptions = {
  title: string;
  author: string;
  pageSize: "a4" | "letter";
  fontSize: number;
  accent: string;
  maps: boolean;
  extraViews: boolean;
  coordinates: boolean;
  mission: boolean;
  science: boolean;
  assumptions: boolean;
  sources: boolean;
  annotations: boolean;
  recommendations: boolean;
  bullets: boolean;
  syntax: boolean;
  includeComparison: boolean;
};
export type Preferences = {
  ai: AISettings;
  theme: "light" | "dark" | "system";
  appearance: "solid" | "glass";
  blur: boolean;
  mapGlass: boolean;
  mapGlassVersion: number;
  terrainMode: "auto" | "terrain" | "image";
  terrainQuality: "low" | "balanced" | "high";
  terrainExaggeration: number;
  adaptiveTerrain: boolean;
  hardware3d: boolean;
  performanceGuard: boolean;
  wasdNavigation: boolean;
  compact: boolean;
  animations: boolean;
  pinchSensitivity: number;
  autosaveMs: number;
  showHints: boolean;
  shortcuts: Record<string, string>;
  report: ReportOptions;
};
export const DEFAULT_REPORT: ReportOptions = {
  title: "Lunar study report",
  author: "",
  pageSize: "a4",
  fontSize: 10,
  accent: "#285e99",
  maps: true,
  extraViews: true,
  coordinates: true,
  mission: true,
  science: true,
  assumptions: true,
  sources: true,
  annotations: true,
  recommendations: true,
  bullets: true,
  syntax: true,
  includeComparison: true,
};
export const DEFAULT_PREFERENCES: Preferences = {
  ai: DEFAULT_AI,
  theme: "system",
  appearance: "solid",
  blur: true,
  mapGlass: true,
  mapGlassVersion: 1,
  terrainMode: "auto",
  terrainQuality: "balanced",
  terrainExaggeration: 1,
  adaptiveTerrain: true,
  hardware3d: true,
  performanceGuard: true,
  wasdNavigation: true,
  compact: true,
  animations: true,
  pinchSensitivity: 1,
  autosaveMs: 700,
  showHints: true,
  shortcuts: {
    save: "Mod+S", open: "Mod+O", new: "Mod+N", undo: "Mod+Z", redo: "Mod+Shift+Z",
    help: "F1", preferences: "Mod+Comma", runTour: "Mod+Shift+T", exportPdf: "Mod+Shift+E",
    map: "Mod+Alt+M", explorer: "Mod+Alt+E", inspector: "Mod+Alt+I", analysis: "Mod+Alt+A",
    mission: "Mod+Alt+P", table: "Mod+Alt+G", science: "Mod+Alt+S", tasks: "Mod+Alt+K", chat: "Mod+Alt+C",
    pan: "Alt+1", site: "Alt+2", point: "Alt+3", line: "Alt+4", polygon: "Alt+5", measure: "Alt+6",
    exportJson: "Mod+Shift+J", exportWorkspace: "Mod+Shift+W", exportCsv: "Mod+Shift+C", exportGeojson: "Mod+Shift+G",
    exportKml: "Mod+Shift+L", exportMissionCsv: "Mod+Shift+M", exportCalendar: "Mod+Shift+I", exportSvg: "Mod+Shift+V", exportPng: "Mod+Alt+Shift+P",
    duplicateProject: "Mod+Shift+D", closeProject: "Mod+Alt+Q", focusStudy: "Alt+F", fitMoon: "Alt+0",
    layoutMapping: "Mod+Alt+1", layoutPlanning: "Mod+Alt+2", layoutAnalysis: "Mod+Alt+3", layoutComparison: "Mod+Alt+4", layoutFocus: "Mod+Alt+5",
    view3d: "Mod+Shift+3", view2d: "Mod+Shift+2", viewOblique: "Mod+Shift+1",
  },
  report: DEFAULT_REPORT,
};
export function isLowPerformanceDevice() {
  if (typeof navigator === "undefined") return false;
  const device = navigator as Navigator & { deviceMemory?: number };
  return (
    (Number.isFinite(device.deviceMemory) && (device.deviceMemory as number) <= 4) ||
    (Number.isFinite(device.hardwareConcurrency) && device.hardwareConcurrency <= 4)
  );
}
export function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem("luna-preferences-v1") || "null");
    return {
      ...DEFAULT_PREFERENCES,
      ...p,
      mapGlass:
        p?.mapGlassVersion === 1 && typeof p?.mapGlass === "boolean"
          ? p.mapGlass
          : true,
      mapGlassVersion: 1,
      terrainMode: ["auto", "terrain", "image"].includes(p?.terrainMode) ? p.terrainMode : "auto",
      terrainQuality: ["low", "balanced", "high"].includes(p?.terrainQuality) ? p.terrainQuality : "balanced",
      terrainExaggeration: Number.isFinite(p?.terrainExaggeration) ? Math.max(1, Math.min(5,p.terrainExaggeration)) : 1,
      adaptiveTerrain: typeof p?.adaptiveTerrain === "boolean" ? p.adaptiveTerrain : true,
      hardware3d: typeof p?.hardware3d === "boolean" ? p.hardware3d : true,
      performanceGuard: typeof p?.performanceGuard === "boolean" ? p.performanceGuard : true,
      wasdNavigation: typeof p?.wasdNavigation === "boolean" ? p.wasdNavigation : true,
      theme: ["light", "dark", "system"].includes(p?.theme)
        ? p.theme
        : "system",
      ai: { ...DEFAULT_AI, ...p?.ai, ...(hosted ? {
        allowWebBrowsing: false,
        ...(["openai", "gemini"].includes(p?.ai?.provider) ? { provider: "browser" as const, model: "" } : {}),
      } : {}) },
      shortcuts: {
        ...DEFAULT_PREFERENCES.shortcuts,
        ...p?.shortcuts,
        // Earlier defaults assigned Mod+Alt+P to both the mission panel and
        // map export, so preserve the panel shortcut and move only the export.
        ...(p?.shortcuts?.exportPng === p?.shortcuts?.mission
          ? { exportPng: DEFAULT_PREFERENCES.shortcuts.exportPng }
          : {}),
      },
      report: { ...DEFAULT_REPORT, ...p?.report, maps: true },
    };
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}
