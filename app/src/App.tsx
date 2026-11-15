import { scienceRequest } from "./scienceClient";
import { hosted } from "./runtime";
import ChatPanel from "./ChatPanel";
import FrostedBackdrop from "./FrostedBackdrop";
import HelpGuide from "./HelpGuide";
import { arrange } from "./layouts";
import { useCallback, useEffect, useRef, useState } from "react";
import { DockviewReact, themeAbyss } from "dockview-react";
import type { DockviewApi, DockviewReadyEvent } from "dockview-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Toaster, toast as sonnerToast } from "sonner";
import "dockview-react/dist/styles/dockview.css";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  CaretRight,
  Check,
  DownloadSimple,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Globe,
  Info,
  Moon,
  Plus,
  X,
} from "@phosphor-icons/react";
import { createStudy, decodeStudy, geometryKey, isStudy, uid } from "./study";
import type { Geometry, Study } from "./study";
import {
  saveFile,
  fileName,
  studyJSON,
  geometryCSV,
  geoJSON,
  kml,
  missionCSV,
  missionICS,
  chartSVG,
  exportPDF,
} from "./exports";
import { WorkspaceContext } from "./WorkspaceContext";
import {
  AnalysisPanel,
  DateField,
  ExplorerPanel,
  InspectorPanel,
  MapPanel,
  MissionPanel,
  Numeric,
  TablePanel,
} from "./Panels";
import type { MapActions, MapTool } from "./MapView";
import SurfaceNavigation from "./SurfaceNavigation";
import type { LunarPoint, RouteOverlay } from "./surfaceRoutes";
import SciencePanel from "./SciencePanel";
import TasksPanel from "./TasksPanel";
import { isLowPerformanceDevice, loadPreferences } from "./preferences";
import { PreferencesPanel } from "./PreferencesPanel";
import "./App.css";
const STORE = "lunar-window-workspace-v2",
  LAYOUT = "lunar-window-docking-v2";
type Workspace = { projects: Study[]; activeId: string; recent?: Study[] };
const EMPTY_STUDY: Study = { ...createStudy("blank"), id: "no-project", name: "No project opened" };
function loadWorkspace(): Workspace {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (
      saved &&
      Array.isArray(saved.projects) &&
      saved.projects.length <= 30 &&
      saved.projects.every(isStudy)
    )
      return {
        projects: saved.projects,
        recent: Array.isArray(saved.recent)
          ? saved.recent.filter(isStudy).slice(0, 20)
          : [],
        activeId: saved.projects.some((s: Study) => s.id === saved.activeId)
          ? saved.activeId
          : saved.projects[0]?.id || "",
      };
  } catch {}
  return { projects: [], activeId: "", recent: [] };
}
const components = {
  map: MapPanel,
  explorer: ExplorerPanel,
  inspector: InspectorPanel,
  analysis: AnalysisPanel,
  mission: MissionPanel,
  table: TablePanel,
  science: SciencePanel,
  tasks: TasksPanel,
  chat: ChatPanel,
  navigation: SurfaceNavigation,
};
const panelTitles = {
  map: "Lunar map",
  explorer: "Project explorer",
  inspector: "Study properties",
  analysis: "Geometry & timeline",
  mission: "Mission plan",
  table: "Geometry table",
  science: "Mission analysis",
  tasks: "Tasks",
  chat: "AI assistant",
  navigation: "Surface navigation",
};
function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  if (!shortcut) return false;
  const keys = shortcut.split("+");
  const expectedMod = keys.includes("Mod");
  if ((event.metaKey || event.ctrlKey) !== expectedMod) return false;
  if (event.altKey !== keys.includes("Alt")) return false;
  if (event.shiftKey !== keys.includes("Shift")) return false;
  const key = keys.at(-1) || "";
  const actual = event.key === "," ? "Comma" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return actual === key;
}
function defaultLayout(api: DockviewApi) {
  api.clear();
  const map = api.addPanel({
    id: "map",
    component: "map",
    title: panelTitles.map,
  });
  api.addPanel({
    id: "mission",
    component: "mission",
    title: panelTitles.mission,
    position: { referencePanel: map },
  });
  api.addPanel({
    id: "table",
    component: "table",
    title: panelTitles.table,
    position: { referencePanel: map },
  });
  api.addPanel({
    id: "science",
    component: "science",
    title: panelTitles.science,
    position: { referencePanel: map },
    inactive: true,
  });
  api.addPanel({
    id: "explorer",
    component: "explorer",
    title: panelTitles.explorer,
    position: { referencePanel: map, direction: "left" },
    initialWidth: 220,
  });
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: panelTitles.inspector,
    position: { referencePanel: map, direction: "right" },
    initialWidth: 290,
  });
  api.addPanel({
    id: "analysis",
    component: "analysis",
    title: panelTitles.analysis,
    position: { referencePanel: map, direction: "below" },
    initialHeight: 226,
  });
  map.api.setActive();
}
function useGeometry(study: Study | null, scenario: "A" | "B") {
  const key = study ? geometryKey(study, scenario) : "";
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    revision: number;
    data?: Geometry;
    error: string;
    pending: boolean;
  }>({ key: "", revision: -1, error: "", pending: true });
  useEffect(() => {
    if (!study) {
      setResult({ key, revision, error: "", pending: false });
      return;
    }
    const controller = new AbortController();
    setResult({ key, revision, error: "", pending: true });
    const timer = setTimeout(async () => {
      try {
        const payload = JSON.parse(key);
        if (revision) payload._recalculation = revision;
        const response = await scienceRequest("/api/geometry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Calculation failed");
        if (!controller.signal.aborted)
          setResult({ key, revision, data, error: "", pending: false });
      } catch (e) {
        if (!controller.signal.aborted)
          setResult({
            key,
            revision,
            error:
              e instanceof Error
                ? e.message
                : "Local geometry service unavailable",
            pending: false,
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, revision]);
  return {
    ...(result.key === key && result.revision === revision
      ? result
      : { key, revision, error: "", pending: true }),
    recalculate: () => setRevision((value) => value + 1),
  };
}
export default function App() {
  const [routeOverlay, setRouteOverlay] = useState<RouteOverlay | null>(null);
  const routePicker = useRef<((point: LunarPoint) => void) | null>(null);
  const setRoutePicker = useCallback((pick: ((point: LunarPoint) => void) | null) => {
    routePicker.current = pick;
  }, []);
  const pickRoutePoint = useCallback((point: LunarPoint) => {
    if (!routePicker.current) return false;
    routePicker.current(point);
    return true;
  }, []);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [mapTabActive, setMapTabActive] = useState(false);
  const [preferencesSection, setPreferencesSection] = useState("appearance");
  const openPreferences = (section = "appearance") => {
    setPreferencesSection(section);
    setDialog("preferences");
  };
  useEffect(() => {
    try {
      localStorage.setItem("luna-preferences-v1", JSON.stringify(preferences));
    } catch {
      /* Preferences still apply for this session if browser storage is full. */
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme;
      document.documentElement.dataset.material = preferences.appearance;
      document.documentElement.dataset.blur = String(preferences.blur);
      document.documentElement.dataset.mapGlassEnabled = String(preferences.mapGlass);
      document.documentElement.dataset.compact = String(preferences.compact);
      document.documentElement.dataset.hints = String(preferences.showHints);
      document.documentElement.dataset.animations = String(preferences.animations);
      document.documentElement.style.setProperty(
        "--camera-animation",
        preferences.animations ? "1" : "0",
      );
      document.documentElement.style.setProperty(
        "--pinch-sensitivity",
        String(preferences.pinchSensitivity),
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences]);
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace),
    [menu, setMenu] = useState<string | null>(null),
    [dialog, setDialog] = useState<"new" | "help" | "preferences" | "preview" | null>(null),
    [previewUrl, setPreviewUrl] = useState<string | null>(null),
    [tool, setTool] = useState<MapTool>("pan"),
    [walkMode, setWalkMode] = useState(false),
    [selectedAnnotation, selectAnnotation] = useState<string | null>(null),
    [saved, setSaved] = useState(true),
    [busy, setBusy] = useState(false);
  const reducedMotion = useReducedMotion();
  const animateUi = preferences.animations && !reducedMotion;
  const [backgroundTasks, setBackgroundTasks] = useState<{ id: string; label: string; progress?: number }[]>([]);
  const [landingProgress, setLandingProgress] = useState<number | null>(null);
  const activeStudy =
    workspace.projects.find((s) => s.id === workspace.activeId) ||
    workspace.projects[0] || null;
  const hasProject = activeStudy !== null;
  const study = activeStudy || EMPTY_STUDY;
  const canRenderEnhanced3d = preferences.hardware3d && !(preferences.performanceGuard && isLowPerformanceDevice());
  useEffect(() => {
    const onLandingProgress = (event: Event) => {
      setLandingProgress((event as CustomEvent<{ progress: number | null }>).detail.progress);
    };
    window.addEventListener("luna-landing-progress", onLandingProgress);
    return () => window.removeEventListener("luna-landing-progress", onLandingProgress);
  }, []);
  const api = useRef<DockviewApi | null>(null),
    mapActions = useRef<MapActions | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    menuRef = useRef<HTMLDivElement>(null),
    history = useRef<Record<string, { undo: Study[]; redo: Study[] }>>({}),
    dragged = useRef<string | null>(null);
  const popoutPanel = useRef<(id: string) => void>(() => {});
  popoutPanel.current = (id) => {
    const dock = api.current;
    const panel = dock?.getPanel(id);
    if (!dock || !panel) return;
    void dock.addPopoutGroup(panel, {
      popoutUrl: "/popout.html",
      onDidOpen: ({ window }) => {
        window.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
        window.document.title = `${study.name} - ${panel.title || "LUNA panel"}`;
      },
    }).then((ok) => {
      if (!ok) notify("Popup blocked. Allow popups for this app and try again.");
    });
  };
  useEffect(() => {
    let gesture: {
      panelId: string;
      pointerId: number;
      started: number;
      axis: "x" | "y" | null;
      last: number;
      direction: number;
      reversals: number;
      travel: number;
    } | null = null;
    let tabMoveSnapshot: Map<string, DOMRect> | null = null;
    let resizeReleaseTimer = 0;
    let resizeFadeTimer = 0;
    let resizeFrame = 0;
    const resizeBaseline = new Map<HTMLElement, { width: number; height: number }>();
    const resizingPanels = new Set<HTMLElement>();
    const updateResizingPanels = () => {
      resizeFrame = 0;
      for (const [panel, baseline] of resizeBaseline) {
        if (!panel.isConnected) {
          resizeBaseline.delete(panel);
          resizingPanels.delete(panel);
          continue;
        }
        const rect = panel.getBoundingClientRect();
        const changed = Math.abs(rect.width - baseline.width) > 0.75 ||
          Math.abs(rect.height - baseline.height) > 0.75;
        if (changed) {
          panel.dataset.panelResizing = "true";
          resizingPanels.add(panel);
        } else {
          delete panel.dataset.panelResizing;
          resizingPanels.delete(panel);
        }
      }
    };
    const trackPanelResize = () => {
      if (!document.documentElement.classList.contains("panel-resizing") || resizeFrame) return;
      // Run after Dockview has applied the sash movement for this pointer event.
      resizeFrame = requestAnimationFrame(updateResizingPanels);
    };
    const beginPanelResize = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".dv-sash, [data-dockview-sash]")) return;
      window.clearTimeout(resizeReleaseTimer);
      window.clearTimeout(resizeFadeTimer);
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      for (const panel of resizingPanels) delete panel.dataset.panelResizing;
      resizingPanels.clear();
      resizeBaseline.clear();
      document.querySelectorAll<HTMLElement>(".dv-groupview").forEach((panel) => {
        const rect = panel.getBoundingClientRect();
        resizeBaseline.set(panel, { width: rect.width, height: rect.height });
      });
      document.documentElement.classList.add("panel-resizing");
    };
    const endPanelResize = () => {
      if (!document.documentElement.classList.contains("panel-resizing")) return;
      window.clearTimeout(resizeReleaseTimer);
      resizeReleaseTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("panel-resizing");
        resizeFadeTimer = window.setTimeout(() => {
          for (const panel of resizingPanels) delete panel.dataset.panelResizing;
          resizingPanels.clear();
          resizeBaseline.clear();
        }, 180);
      }, 80);
    };
    const capturePanelTabPositions = () => {
      const positions = new Map<string, DOMRect>();
      document.querySelectorAll<HTMLElement>(".dv-tab[data-tab-panel-id]").forEach((tab) => {
        const id = tab.dataset.tabPanelId;
        if (id) positions.set(id, tab.getBoundingClientRect());
      });
      return positions;
    };
    const animatePanelTabMoves = (before: Map<string, DOMRect>) => {
      if (document.documentElement.dataset.animations === "false" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>(".dv-tab[data-tab-panel-id]").forEach((tab) => {
          const previous = before.get(tab.dataset.tabPanelId || "");
          if (!previous || !tab.isConnected) return;
          const next = tab.getBoundingClientRect();
          const dx = previous.left - next.left;
          const dy = previous.top - next.top;
          if (Math.abs(dx) + Math.abs(dy) < 2) return;
          tab.animate(
            [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
            { duration: 240, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
          );
        });
      });
    };
    const down = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const tab = target?.closest<HTMLElement>(".dv-tab");
      const panelId = tab?.dataset.tabPanelId;
      if (!panelId || target?.closest("button")) return;
      if (event.button === 0) tabMoveSnapshot = capturePanelTabPositions();
      gesture = {
        panelId,
        pointerId: event.pointerId,
        started: performance.now(),
        axis: null,
        last: 0,
        direction: 0,
        reversals: 0,
        travel: 0,
      };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const elapsed = performance.now() - gesture.started;
      if (elapsed > 650) { gesture = null; return; }
      const x = Math.abs(event.movementX), y = Math.abs(event.movementY);
      if (!gesture.axis && Math.max(x, y) > 7) {
        gesture.axis = x >= y ? "x" : "y";
        gesture.last = gesture.axis === "x" ? event.clientX : event.clientY;
      }
      if (!gesture.axis) return;
      const position = gesture.axis === "x" ? event.clientX : event.clientY;
      const delta = position - gesture.last;
      if (Math.abs(delta) < 6) return;
      const direction = Math.sign(delta);
      gesture.travel += Math.abs(delta);
      if (gesture.direction && direction !== gesture.direction) gesture.reversals++;
      gesture.direction = direction;
      gesture.last = position;
      if (gesture.reversals >= 3 && gesture.travel >= 72) {
        const id = gesture.panelId;
        gesture = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        popoutPanel.current(id);
      }
    };
    const end = () => {
      gesture = null;
      if (tabMoveSnapshot) animatePanelTabMoves(tabMoveSnapshot);
      tabMoveSnapshot = null;
    };
    const panelCloseTimers = new Map<string, number>();
    const animatePanelClose = (event: Event, tab: HTMLElement, panelId: string) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (panelCloseTimers.has(panelId)) return;
      const siblings = [...(tab.parentElement?.querySelectorAll<HTMLElement>(".dv-tab") || [])]
        .filter((candidate) => candidate !== tab)
        .map((node) => ({ node, rect: node.getBoundingClientRect() }));
      const duration = document.documentElement.dataset.animations === "false" || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 170;
      if (duration) {
        tab.classList.add("tab-closing");
        panelCloseTimers.set(panelId, window.setTimeout(() => {
          panelCloseTimers.delete(panelId);
          const panel = api.current?.getPanel(panelId);
          if (!panel) return;
          api.current?.removePanel(panel);
          requestAnimationFrame(() => {
            for (const { node, rect } of siblings) {
              if (!node.isConnected) continue;
              const next = node.getBoundingClientRect();
              const dx = rect.left - next.left;
              const dy = rect.top - next.top;
              if (Math.abs(dx) + Math.abs(dy) > 1)
                node.animate(
                  [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
                  { duration: 210, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
                );
            }
          });
        }, duration));
      } else {
        const panel = api.current?.getPanel(panelId);
        if (panel) api.current?.removePanel(panel);
      }
    };
    const closePanelTab = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      const tab = target?.closest<HTMLElement>(".dv-tab");
      const panelId = tab?.dataset.tabPanelId;
      if (!panelId) return;
      animatePanelClose(event, tab, panelId);
    };
    const closePanelTabButton = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".dv-default-tab-action")) return;
      const tab = target.closest<HTMLElement>(".dv-tab");
      const panelId = tab?.dataset.tabPanelId;
      if (tab && panelId) animatePanelClose(event, tab, panelId);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerdown", beginPanelResize, true);
    document.addEventListener("pointermove", trackPanelResize, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    document.addEventListener("pointerup", endPanelResize, true);
    document.addEventListener("pointercancel", endPanelResize, true);
    document.addEventListener("auxclick", closePanelTab, true);
    document.addEventListener("click", closePanelTabButton, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerdown", beginPanelResize, true);
      document.removeEventListener("pointermove", trackPanelResize, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("pointercancel", end, true);
      document.removeEventListener("pointerup", endPanelResize, true);
      document.removeEventListener("pointercancel", endPanelResize, true);
      window.clearTimeout(resizeReleaseTimer);
      window.clearTimeout(resizeFadeTimer);
      cancelAnimationFrame(resizeFrame);
      document.documentElement.classList.remove("panel-resizing");
      for (const panel of resizingPanels) delete panel.dataset.panelResizing;
      document.removeEventListener("auxclick", closePanelTab, true);
      document.removeEventListener("click", closePanelTabButton, true);
      panelCloseTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const active = hasProject && mapTabActive;
    root.dataset.mapActive = String(active);
    root.dataset.mapGlassActive = String(preferences.mapGlass && active);
    if (active) mapActions.current?.requestRender();
    else if (!hasProject) {
      api.current = null;
      mapActions.current = null;
      setMapTabActive(false);
    }
  }, [hasProject, mapTabActive, preferences.mapGlass]);
  const a = useGeometry(activeStudy, "A"),
    b = useGeometry(activeStudy, "B");
  const geometry = a.data,
    compare = b.data;
  const notify = useCallback((s: string) => {
    sonnerToast.info(s, { duration: 5000 });
  }, []);
  const update = useCallback(
    (p: Partial<Study>) =>
      setWorkspace((prev) => {
        const current = prev.projects.find((s) => s.id === prev.activeId)!;
        if (!isStudy({ ...current, ...p })) {
          queueMicrotask(() =>
            notify(
              "Change rejected: check the study date range, activity duration or coordinates.",
            ),
          );
          return prev;
        }
        if (
          !("cursor" in p) &&
          Object.keys(p).some(
            (k) =>
              ![
                "view",
                "layer",
                "grid",
                "lighting",
                "directions",
                "active",
                "alignment",
              ].includes(k),
          )
        ) {
          const h = history.current[current.id] ?? { undo: [], redo: [] };
          h.undo = [...h.undo.slice(-39), structuredClone(current)];
          h.redo = [];
          history.current[current.id] = h;
        }
        return {
          ...prev,
          projects: prev.projects.map((s) =>
            s.id === prev.activeId ? { ...s, ...p } : s,
          ),
        };
      }),
    [],
  );
  const undo = (redo = false) => {
    const h = history.current[study.id];
    if (!h) return;
    const stack = redo ? h.redo : h.undo;
    const value = stack.pop();
    if (!value) return;
    (redo ? h.undo : h.redo).push(structuredClone(study));
    setWorkspace((p) => ({
      ...p,
      projects: p.projects.map((s) => (s.id === value.id ? value : s)),
    }));
    notify(redo ? "Change restored" : "Change undone");
  };
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(workspace));
        setSaved(true);
      } catch {
        notify(
          "Browser storage is full or unavailable. Export your project to keep it.",
        );
      }
    }, preferences.autosaveMs);
    return () => clearTimeout(t);
  }, [workspace, notify, preferences.autosaveMs]);
  useEffect(() => {
    if (hosted) return;
    let live = true;
    const refreshTasks = async () => {
      const [offline, ai] = await Promise.allSettled([
        fetch("/api/offline/status").then((r) => r.ok ? r.json() : null),
        fetch("/api/ai/status").then((r) => r.ok ? r.json() : null),
      ]);
      if (!live) return;
      const tasks: { id: string; label: string; progress?: number }[] = [];
      if (offline.status === "fulfilled" && offline.value?.jobs)
        tasks.push(...offline.value.jobs.filter((job: { status: string }) => ["starting", "running"].includes(job.status)).map((job: { id: string; layer: string; level: number; done: number; total: number }) => ({ id: `map-${job.id}`, label: `Map download: ${job.layer} L${job.level}`, progress: job.total ? job.done / job.total : undefined })));
      if (ai.status === "fulfilled" && ai.value?.jobs)
        tasks.push(...ai.value.jobs.filter((job: { status: string }) => ["starting", "running"].includes(job.status)).map((job: { id: string; kind: string; message: string; progress: number }) => ({ id: `ai-${job.id}`, label: job.message || job.kind, progress: job.progress })));
      if (live) setBackgroundTasks(tasks);
    };
    void refreshTasks();
    const timer = window.setInterval(refreshTasks, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const showPanel = useCallback((id: string) => {
    setDialog(null);
    const dock = api.current;
    if (!dock) return;
    const existing = dock.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    dock.addPanel({
      id,
      component: id,
      title: panelTitles[id as keyof typeof panelTitles],
      position: dock.getPanel("map") ? { referencePanel: "map", direction: id === "navigation" ? "right" : "within" } : undefined,
      initialWidth: id === "navigation" ? 360 : undefined,
    });
  }, []);
  const showRouteMap = useCallback(() => {
    const dock = api.current;
    const navigation = dock?.getPanel("navigation");
    if (!dock || !navigation) return;
    const map = dock.getPanel("map");
    if (!map) {
      dock.addPanel({ id: "map", component: "map", title: panelTitles.map,
        position: { referencePanel: navigation, direction: "left" } });
    } else {
      if (map.group === navigation.group) navigation.api.moveTo({ group: map.group, position: "right" });
      map.api.setActive();
      navigation.api.setActive();
    }
    setTool("pan");
  }, []);
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(workspace));
      notify("All open projects saved on this device");
      setSaved(true);
    } catch {
      notify("Save failed. Export a project file instead.");
    }
  };
  const addProject = (s: Study) => {
    if (workspace.projects.length >= 30) {
      notify("Close a project before opening more (30 project limit).");
      return;
    }
    setWorkspace((p) => ({
      ...p,
      projects: [...p.projects, s],
      activeId: s.id,
    }));
    setDialog(null);
    selectAnnotation(null);
    setTool("pan");
    showPanel("map");
  };
  const closeProject = (id: string) =>
    setWorkspace((p) => {
      const projects = p.projects.filter((s) => s.id !== id);
      const closed = p.projects.find((s) => s.id === id);
      const recent = closed
        ? [closed, ...(p.recent || []).filter((s) => s.id !== id)].slice(0, 20)
        : p.recent || [];
      if (!projects.length) return { projects, activeId: "", recent };
      return {
        recent,
        projects,
        activeId:
          p.activeId === id
            ? projects[
                Math.max(0, p.projects.findIndex((x) => x.id === id) - 1)
              ].id
            : p.activeId,
      };
    });
  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    let added: Study[] = [];
    for (const file of Array.from(files)) {
      try {
        if (file.size > 20 * 1024 * 1024)
          throw new Error("File is larger than 20 MB");
        const value = JSON.parse(await file.text());
        const candidates = Array.isArray(value.projects)
          ? value.projects
          : [value.study || value];
        for (const candidate of candidates) {
          const opened = decodeStudy(candidate);
          if (!opened)
            throw new Error(
              "Not a supported Lunar Window v2 study. Check coordinates, activities and dates.",
            );
          added.push({ ...opened, id: uid() });
        }
      } catch (e) {
        notify(
          `${file.name}: ${e instanceof Error ? e.message : "Could not open"}`,
        );
      }
    }
    if (added.length) {
      setWorkspace((prev) => {
        added = added.slice(0, 30 - prev.projects.length);
        return {
          ...prev,
          projects: [...prev.projects, ...added],
          activeId: added[0]?.id || prev.activeId,
        };
      });
      showPanel("map");
      notify(`Opened ${added.length} project(s)`);
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const exportAs = async (format: string, reportToCaller = false) => {
    if (busy) {
      if (reportToCaller) throw new Error("Another export is already running.");
      return;
    }
    setMenu(null);
    const name = fileName(study);
    try {
      if (["pdf", "csv", "svg"].includes(format) && (!geometry || !compare))
        throw new Error(
          "Wait for both scenario calculations before exporting geometry.",
        );
      if (format === "json")
        saveFile(
          studyJSON(study, geometry, compare),
          "application/json",
          `${name}.lunar.json`,
        );
      if (format === "workspace")
        saveFile(
          JSON.stringify(
            { format: "lunar-window-workspace-v2", ...workspace },
            null,
            2,
          ),
          "application/json",
          "lunar-window.workspace.json",
        );
      if (format === "csv")
        saveFile(
          geometryCSV(study, geometry, compare),
          "text/csv",
          `${name}-geometry.csv`,
        );
      if (format === "geojson")
        saveFile(
          JSON.stringify(geoJSON(study), null, 2),
          "application/geo+json",
          `${name}.moon.geojson`,
        );
      if (format === "kml")
        saveFile(
          kml(study),
          "application/vnd.google-earth.kml+xml",
          `${name}.moon.kml`,
        );
      if (format === "missioncsv")
        saveFile(missionCSV(study), "text/csv", `${name}-mission.csv`);
      if (format === "ics")
        saveFile(missionICS(study), "text/calendar", `${name}-mission.ics`);
      if (format === "svg")
        saveFile(
          chartSVG(study, geometry, compare),
          "image/svg+xml",
          `${name}-geometry.svg`,
        );
      if (format === "png") {
        showPanel("map");
        await new Promise((r) => setTimeout(r, 150));
        const image = mapActions.current?.screenshot();
        if (!image) throw new Error("Open the lunar map first");
        const response = await fetch(image);
        saveFile(await response.blob(), "image/png", `${name}-map.png`);
      }
      if (format === "pdf") {
        if (!geometry || !compare)
          throw new Error(
            "Wait for both scenario calculations before exporting a report.",
          );
        setBusy(true);
        showPanel("map");
        await new Promise((r) => setTimeout(r, 150));
        notify(
          "Preparing report: waiting for map imagery and capturing views…",
        );
        let image: string | undefined;
        let views: { label: string; image: string }[] = [];
        try {
          image = await mapActions.current?.readyScreenshot(5000);
        } catch {
          notify("Live map imagery is unavailable. The PDF will include a clearly labeled site locator and mission chart.");
        }
        if (image && preferences.report.extraViews) {
          try {
            views = (await mapActions.current?.captureViews(undefined, undefined, 5000)) || [];
          } catch {
            notify("Additional map views were unavailable; the report still includes its primary map figure and geometry chart.");
          }
        }
        const blob = await exportPDF(
          study,
          geometry,
          compare,
          image,
          preferences.report,
          views,
        );
        saveFile(blob, "application/pdf", `${name}-study.pdf`);
        setBusy(false);
      }
      notify(`${format.toUpperCase()} exported`);
    } catch (e) {
      setBusy(false);
      const error = e instanceof Error ? e : new Error("Export failed");
      notify(error.message);
      if (reportToCaller) throw error;
    }
  };
  const previewReport = async () => {
    if (!geometry || !compare) {
      notify("Wait for both scenario calculations before previewing the report.");
      return;
    }
    setMenu(null);
    setBusy(true);
    try {
      showPanel("map");
      await new Promise((resolve) => setTimeout(resolve, 180));
      let image: string | undefined;
      let views: { label: string; image: string }[] = [];
      try {
        image = await mapActions.current?.readyScreenshot(5000);
      } catch {
        notify("Live map imagery is unavailable. The preview will use a clearly labeled site locator and mission chart.");
      }
      if (image && preferences.report.extraViews) {
        try {
          views = (await mapActions.current?.captureViews(undefined, undefined, 5000)) || [];
        } catch {
          notify("Additional map views were unavailable; the report still has its primary figure and mission chart.");
        }
      }
      const blob = await exportPDF(study, geometry, compare, image, preferences.report, views);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setDialog("preview");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Report preview failed");
    } finally {
      setBusy(false);
    }
  };
  const startTour = () => {
    setDialog(null);
    showPanel("map");
    driver({
      showProgress: true,
      allowClose: true,
      animate: false,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Finish",
      steps: [
        {
          element: '[data-tour="projects"]',
          popover: {
            title: "Your projects",
            description:
              "Create or open studies from File. Each project keeps its own sites, mission, annotations and satellites. Drag these tabs to reorder them.",
          },
        },
        {
          element: ".dv-tabs-and-actions-container",
          popover: {
            title: "Arrange your editor",
            description:
              "Drag panel tabs to reorder, split or dock panels. Resize using the borders between panes. Reopen closed panels from View.",
          },
        },
        {
          element: '[data-tour="map"]',
          popover: {
            title: "Explore the whole Moon",
            description:
              "LROC imagery streams from NASA. Drag to rotate, use the wheel to zoom, and right-drag to tilt. Switch between globe, 2D and oblique views.",
          },
        },
        {
          element: '[data-tour="map-tools"]',
          popover: {
            title: "Work on the map",
            description:
              "Pick a study point, add labeled notes, draw traverses and regions, or measure lunar surface distances. Finish a drawing with the map button.",
          },
        },
        {
          element: '[data-tour="inspector"]',
          popover: {
            title: "Edit actual study parameters",
            description:
              "Change latitude, longitude, height, UTC start, mission duration and sampling. Calculations update using the local NASA SPICE service. Enter commits a numeric field.",
          },
        },
        {
          element: '[data-tour="analysis"]',
          popover: {
            title: "Inspect changing geometry",
            description:
              "Scrub to a precise mission time. Sun and Earth arrows, solar lighting and satellite positions update with time. Reference windows use an ideal horizon; terrain is not calculated.",
          },
        },
        {
          element: '[data-tour="mission-button"]',
          popover: {
            title: "Build a mission plan",
            description:
              "Add scheduled activities, durations and operational notes. Review solar and Earth geometry at each activity start.",
          },
        },
        {
          element: '[data-tour="export"]',
          popover: {
            title: "Take your study with you",
            description:
              "Export a reopenable project, PDF report, lunar GeoJSON/KML, geometry CSV, mission calendar, vector chart or map image. Use JSON for complete inputs and model metadata.",
          },
        },
      ],
    }).drive();
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setDialog(null);
        setTool("pan");
      }
      if ((e.target as HTMLElement).matches("input,textarea,select") || dialog)
        return;
      const shortcuts = preferences.shortcuts;
      const actions: Record<string, () => void> = {
        save: () => save(),
        open: () => fileInput.current?.click(),
        new: () => setDialog("new"),
        undo: () => undo(),
        redo: () => undo(true),
        help: () => setDialog("help"),
        preferences: () => openPreferences("general"),
        runTour: () => startTour(),
        exportPdf: () => void exportAs("pdf"),
        exportJson: () => void exportAs("json"),
        exportWorkspace: () => void exportAs("workspace"),
        exportCsv: () => void exportAs("csv"),
        exportGeojson: () => void exportAs("geojson"),
        exportKml: () => void exportAs("kml"),
        exportMissionCsv: () => void exportAs("missioncsv"),
        exportCalendar: () => void exportAs("ics"),
        exportSvg: () => void exportAs("svg"),
        exportPng: () => void exportAs("png"),
        duplicateProject: () => addProject({ ...structuredClone(study), id: uid(), name: `${study.name.slice(0, 95)} copy` }),
        closeProject: () => closeProject(study.id),
        focusStudy: () => mapActions.current?.site(),
        fitMoon: () => { update({ view: "3d" }); mapActions.current?.home(); },
        layoutMapping: () => { if (api.current) arrange(api.current, "mapping"); },
        layoutPlanning: () => { if (api.current) arrange(api.current, "planning"); },
        layoutAnalysis: () => { if (api.current) arrange(api.current, "analysis"); },
        layoutComparison: () => { if (api.current) arrange(api.current, "comparison"); },
        layoutFocus: () => { if (api.current) arrange(api.current, "focus"); },
        view3d: () => { showPanel("map"); update({ view: "3d" }); },
        view2d: () => { showPanel("map"); update({ view: "2d" }); },
        viewOblique: () => { showPanel("map"); update({ view: "oblique" }); },
        ...Object.fromEntries(Object.keys(panelTitles).map((id) => [id, () => showPanel(id)])),
        ...Object.fromEntries((["pan", "site", "point", "line", "polygon", "measure"] as MapTool[]).map((id) => [id, () => { showPanel("map"); setTool(id); }])),
      };
      const match = Object.entries(actions).find(([id]) => matchesShortcut(e, shortcuts[id]));
      if (match) {
        e.preventDefault();
        match[1]();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const onReady = (event: DockviewReadyEvent) => {
    api.current = event.api;
    try {
      const layout = JSON.parse(localStorage.getItem(LAYOUT) || "null");
      if (layout) event.api.fromJSON(layout);
      else defaultLayout(event.api);
    } catch {
      defaultLayout(event.api);
    }
    const syncMapTab = () => {
      const visible = event.api.groups.some(
        (group) => group.isVisible && group.activePanel?.id === "map",
      );
      setMapTabActive(visible);
      if (visible) mapActions.current?.requestRender();
    };
    syncMapTab();
    event.api.onDidActivePanelChange(syncMapTab);
    event.api.onDidAddPanel(syncMapTab);
    event.api.onDidRemovePanel(syncMapTab);
    event.api.onDidLayoutChange(() => {
      syncMapTab();
      try {
        localStorage.setItem(LAYOUT, JSON.stringify(event.api.toJSON()));
      } catch {}
    });
  };
  useEffect(() => {
    document.title = hasProject ? `${study.name} - LUNA` : "LUNA";
  }, [hasProject, study.name]);
  const value = {
    preferences,
    setPreferences,
    openPreferences,
    exportFile: (format: string) => exportAs(format, true),
    previewReport,
    undo,
    arrangeLayout: (preset: string) => {
      if (api.current) arrange(api.current, preset);
    },
    study,
    addStudy: addProject,
    projects: workspace.projects,
    update,
    geometry,
    compare,
    computing: a.pending || b.pending,
    error: a.error || b.error,
    recalculate: () => { a.recalculate(); b.recalculate(); },
    mapActions,
    tool,
    setTool,
    walkMode,
    setWalkMode,
    notify,
    selectedAnnotation,
    selectAnnotation,
    addAnnotation: (annotation: Study["annotations"][number]) => {
      update({ annotations: [...study.annotations, annotation] });
      selectAnnotation(annotation.id);
      notify(`Added ${annotation.name}`);
    },
    routeOverlay,
    setRouteOverlay,
    setRoutePicker,
    pickRoutePoint,
    showRouteMap,
    showPanel,
    openHelp: () => setDialog("help"),
    runTour: startTour,
  };
  return (
    <WorkspaceContext.Provider value={value}>
      <div className="app">
        <div id="live-map-layer" aria-hidden="true" />
        <FrostedBackdrop />
        <header className="commandbar unified-header" ref={menuRef}>
          <div className="brand" title={hasProject ? study.name : "LUNA"}>
            <span className="brand-mark">
              <span className="brand-logo" aria-hidden="true" />
            </span>
            {hasProject ? <input
              className="inline-project-title"
              aria-label="Project title"
              key={study.id}
              defaultValue={study.name}
              maxLength={100}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name) update({ name });
                else e.target.value = study.name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = study.name;
                  e.currentTarget.blur();
                }
              }}
            /> : <strong className="empty-brand-title">LUNA</strong>}
          </div>
          {["File", "Edit", "View", "Window", "Export"].filter((name) => hasProject || name === "File").map((name) => (
            <div className="menu-wrap" key={name}>
              <button
                data-tour={name === "Export" ? "export" : undefined}
                className={menu === name ? "active" : ""}
                onClick={() => setMenu((v) => (v === name ? null : name))}
              >
                {name}
                <CaretDown size={10} />
              </button>
              {menu === name && (
                <div className="menu">
                  {name === "File" ? (
                    <>
                      <button
                        title={`New project (${preferences.shortcuts.new})`}
                        onClick={() => {
                          setDialog("new");
                          setMenu(null);
                        }}
                      >
                        <FilePlus />
                        New project…<kbd>{preferences.shortcuts.new}</kbd>
                      </button>
                      <button
                        title={`Open project (${preferences.shortcuts.open})`}
                        onClick={() => {
                          fileInput.current?.click();
                          setMenu(null);
                        }}
                      >
                        <FolderOpen />
                        Open project / workspace…<kbd>{preferences.shortcuts.open}</kbd>
                      </button>
                      <button
                        onClick={() => {
                          setDialog("new");
                          setMenu(null);
                        }}
                      >
                        <Plus />
                        Create from template…
                      </button>
                      <hr />
                      <button
                        onClick={() => {
                          save();
                          setMenu(null);
                        }}
                      >
                        <FloppyDisk />
                        Save all projects<kbd>{preferences.shortcuts.save}</kbd>
                      </button>
                      {hasProject && <button onClick={() => exportAs("json")}>
                        <DownloadSimple />
                        Save project file…
                      </button>}
                      {hasProject && <button onClick={() => exportAs("workspace")}>
                        Save workspace file…
                      </button>}
                      <button
                        onClick={() => {
                          openPreferences();
                          setMenu(null);
                        }}
                      >
                        Preferences…
                      </button>
                      <button
                        onClick={() => {
                          openPreferences("report");
                          setMenu(null);
                        }}
                      >
                        Set up report…
                      </button>
                      <hr />
                      {hasProject && <button
                        onClick={() => {
                          closeProject(study.id);
                          setMenu(null);
                        }}
                      >
                        Close active project
                      </button>}
                      {(workspace.recent || []).length > 0 && (
                        <>
                          <hr />
                          <div className="submenu-wrap">
                            <button className="submenu-trigger" aria-haspopup="menu">
                              Recently Closed <CaretRight size={13} />
                            </button>
                            <div className="menu submenu" role="menu">
                              {(workspace.recent || []).map((recent) => (
                                <button
                                  key={recent.id}
                                  role="menuitem"
                                  onClick={() => {
                                    setWorkspace((p) => ({
                                      ...p,
                                      projects: [...p.projects, recent],
                                      activeId: recent.id,
                                      recent: (p.recent || []).filter((s) => s.id !== recent.id),
                                    }));
                                    setMenu(null);
                                    showPanel("map");
                                  }}
                                >{recent.name}</button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  ) : name === "Edit" ? (
                    <>
                      {hasProject && <button
                        onClick={() => {
                          undo();
                          setMenu(null);
                        }}
                      >
                        <ArrowUUpLeft />
                        Undo
                        <kbd>{preferences.shortcuts.undo}</kbd>
                      </button>}
                      {hasProject && <button
                        onClick={() => {
                          undo(true);
                          setMenu(null);
                        }}
                      >
                        <ArrowUUpRight />
                        Redo
                        <kbd>{preferences.shortcuts.redo}</kbd>
                      </button>}
                      <hr />
                      {hasProject && <button
                        onClick={() => {
                          addProject({
                            ...structuredClone(study),
                            id: uid(),
                            name: `${study.name.slice(0, 95)} copy`,
                          });
                          setMenu(null);
                        }}
                      >
                        Duplicate project
                      </button>}
                    </>
                  ) : name === "View" ? (
                    <>
                      {Object.entries(panelTitles).map(([id, title]) => (
                        <button
                          key={id}
                          onClick={() => {
                            showPanel(id);
                            setMenu(null);
                          }}
                        >
                          {title}
                        </button>
                      ))}
                      <hr />
                      <button
                        className="menu-check"
                        disabled={!preferences.wasdNavigation}
                        title={!preferences.wasdNavigation ? "Enable WASD lunar navigation in Preferences first" : "WASD moves over the surface; hold Shift to move faster"}
                        onClick={() => {
                          const next = !walkMode;
                          setWalkMode(next);
                          if (next) showPanel("map");
                          setMenu(null);
                        }}
                      >
                        <span className={`menu-dot-check ${walkMode ? "checked" : ""}`} aria-hidden="true" />
                        Moon walk <small>WASD · Shift</small>
                      </button>
                      <hr />
                      <button
                        onClick={() => {
                          if (api.current) defaultLayout(api.current);
                          setMenu(null);
                        }}
                      >
                        <ArrowCounterClockwise />
                        Reset panel layout
                      </button>
                      {hasProject && <>
                        <hr />
                        <small className="menu-heading">3D descent preview</small>
                        {landingProgress !== null && <small className="landing-menu-status" role="status">
                          {landingProgress >= 1 ? "Descent preview complete" : `Descending · ${Math.round(landingProgress * 100)}%`}
                        </small>}
                        <button disabled={!canRenderEnhanced3d || (landingProgress !== null && landingProgress < 1)} title={!canRenderEnhanced3d ? "Enable 3D hardware or turn off the performance guard in Preferences" : "Preview the illustrative descent at the active study point"} onClick={() => mapActions.current?.previewLanding()}>
                          Preview landing
                        </button>
                        <button disabled={!canRenderEnhanced3d || (landingProgress !== null && landingProgress < 1)} title="Record an illustrative 3D descent as WebM" onClick={() => mapActions.current?.recordLanding()}>
                          Record descent · WebM
                        </button>
                        {landingProgress !== null && <button onClick={() => mapActions.current?.resetLanding()}>
                          Reset descent preview
                        </button>}
                        <small className="landing-menu-note">Schematic only · not to scale or a validated flight path</small>
                      </>}
                      <button
                        onClick={() => {
                          mapActions.current?.site();
                          setMenu(null);
                        }}
                      >
                        Focus study point
                      </button>
                      <button
                        onClick={() => {
                          setTool("site");
                          showPanel("map");
                          setMenu(null);
                        }}
                      >
                        Pick study point on map
                      </button>
                      <button
                        onClick={() => {
                          showPanel("table");
                          setMenu(null);
                        }}
                      >
                        Open geometry table
                      </button>
                      <hr />
                      <small className="menu-heading">Map layers</small>
                      <select
                        aria-label="Map surface layer"
                        value={study.layer}
                        onChange={(e) =>
                          update({ layer: e.target.value as Study["layer"] })
                        }
                      >
                        {["imagery", "elevation", "hillshade", "slope"].map(
                          (x) => (
                            <option key={x}>{x}</option>
                          ),
                        )}
                      </select>
                      {(
                        [
                          ["grid", "Coordinate grid"],
                          ["lighting", "Solar lighting"],
                          ["directions", "Sun / Earth arrows"],
                          ["stars", "Stars · 3D only"],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="menu-check" key={key}>
                          <input
                            type="checkbox"
                            checked={!!study[key]}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              update({ [key]: checked, ...(key === "stars" && checked ? { view: "3d" as const } : {}) });
                              if (key === "stars" && checked) requestAnimationFrame(() => mapActions.current?.home());
                            }}
                          />
                          {label}
                        </label>
                      ))}
                      <button
                        onClick={() => {
                          update({ view: "3d" });
                          mapActions.current?.home();
                          setMenu(null);
                        }}
                      >
                        <Globe />
                        Fit whole Moon
                      </button>
                    </>
                  ) : name === "Window" ? (
                    <>
                      <small className="menu-heading">
                        Arrangement presets
                      </small>
                      {[
                        ["mapping", "Mapping workspace"],
                        ["planning", "Mission planning"],
                        ["analysis", "Analysis beside map"],
                        ["comparison", "Scenario comparison"],
                        ["focus", "Focus map"],
                      ].map(([id, title]) => (
                        <button
                          key={id}
                          onClick={() => {
                            if (api.current) arrange(api.current, id);
                            setMenu(null);
                          }}
                        >
                          {title}
                        </button>
                      ))}
                      <hr />
                      <button
                        onClick={() => {
                          const panel = api.current?.activePanel;
                          if (panel)
                            api.current?.addFloatingGroup(panel, {
                              x: 100,
                              y: 80,
                              width: 650,
                              height: 500,
                            });
                          setMenu(null);
                        }}
                      >
                        Float active panel
                      </button>
                      <button
                        onClick={() => {
                          const panel = api.current?.activePanel;
                          if (panel)
                            void api.current
                              ?.addPopoutGroup(panel, {
                                popoutUrl: "/popout.html",
                                onDidOpen: (event) => {
                                  event.window.document.documentElement.dataset.theme =
                                    document.documentElement.dataset.theme;
                                  event.window.document.title =
                                    study.name + " - LUNA panel";
                                },
                              })
                              .then((ok) => {
                                if (!ok)
                                  notify(
                                    "Popup blocked. Allow popups for this app and try again.",
                                  );
                              });
                          setMenu(null);
                        }}
                      >
                        Pop active panel into a window
                      </button>
                      <button
                        onClick={() => {
                          const dock = api.current,
                            panel = dock?.activePanel;
                          if (dock && panel) {
                            if (dock.hasMaximizedGroup())
                              dock.exitMaximizedGroup();
                            else dock.maximizeGroup(panel);
                          }
                          setMenu(null);
                        }}
                      >
                        Maximize / restore active panel
                      </button>
                    </>
                  ) : (
                    <>
                      {[
                        ["pdf", "Study report", "PDF"],
                        ["json", "Reopenable study + results", "JSON"],
                        ["workspace", "All open projects", "JSON"],
                        ["csv", "Sun, Earth & satellite samples", "CSV"],
                        ["geojson", "Sites & annotations", "Lunar GeoJSON"],
                        ["kml", "Sites & annotations", "Moon KML"],
                        ["missioncsv", "Mission activities", "CSV"],
                        ["ics", "Mission calendar", "ICS"],
                        ["svg", "Geometry chart", "SVG"],
                        ["png", "Current map view", "PNG"],
                      ].map(([format, label, ext]) => (
                        format === "pdf" ? (
                          <div className="menu-action-row" key={format}>
                            <button onClick={() => exportAs(format)}>{label}<small>{ext}</small></button>
                            <button className="menu-info" title="Preview report PDF" aria-label="Preview report PDF" onClick={previewReport}><Info size={14} /></button>
                          </div>
                        ) : <button key={format} onClick={() => exportAs(format)}>{label}<small>{ext}</small></button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <button className="help-top" onClick={() => setDialog("help")}>
            <Info size={15} />
            Help
          </button>
          <span className="command-divider" />
          <button
            title="Save all projects"
            aria-label="Save all projects"
            onClick={save}
          >
            <FloppyDisk size={16} />
          </button>
          {hasProject && <button title={`Undo (${preferences.shortcuts.undo})`} aria-label="Undo" onClick={() => undo()}>
            <ArrowUUpLeft size={16} />
          </button>}
          {hasProject && <button title={`Redo (${preferences.shortcuts.redo})`} aria-label="Redo" onClick={() => undo(true)}>
            <ArrowUUpRight size={16} />
          </button>}
          <span className="command-spacer" />
          {hasProject && <><span className="alignment-label">Compare by</span>
          <div className="segmented animated-segmented">
            <button
              className={study.alignment === "elapsed" ? "active" : ""}
              onClick={() => update({ alignment: "elapsed" })}
            >
              {study.alignment === "elapsed" && animateUi && <motion.span className="segment-indicator" layoutId="compare-by-indicator" transition={{ type: "spring", duration: 0.28, bounce: 0.12 }} />}
              <span>Mission time</span>
            </button>
            <button
              className={study.alignment === "utc" ? "active" : ""}
              onClick={() => update({ alignment: "utc" })}
            >
              {study.alignment === "utc" && animateUi && <motion.span className="segment-indicator" layoutId="compare-by-indicator" transition={{ type: "spring", duration: 0.28, bounce: 0.12 }} />}
              <span>UTC</span>
            </button>
          </div>
          <span className="save-state" aria-live="polite">
            <Check size={12} />
            {saved ? "Saved" : "Saving…"}
          </span></>}
        </header>
        <div className="project-tabs" data-tour="projects">
          <AnimatePresence initial={false}>
          {workspace.projects.map((project) => (
            <motion.div
              className={`project-tab ${project.id === workspace.activeId ? "active" : ""}`}
              key={project.id}
              layout
              initial={animateUi ? { opacity: 0, transform: "translateX(12px)" } : false}
              animate={{ opacity: 1, transform: "translateX(0px)" }}
              exit={animateUi ? { opacity: 0, transform: "translateX(-18px) scale(.97)" } : { opacity: 1 }}
              transition={{
                layout: { duration: animateUi ? 0.22 : 0, ease: [0.23, 1, 0.32, 1] },
                opacity: { duration: animateUi ? 0.16 : 0 },
                transform: { duration: animateUi ? 0.2 : 0, ease: [0.23, 1, 0.32, 1] },
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeProject(project.id);
                }
              }}
              draggable
              onDragStart={(e) => {
                dragged.current = project.id;
                (e as unknown as React.DragEvent<HTMLDivElement>).dataTransfer.setData("text/lunar-project", project.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => e.currentTarget.classList.add("drop-target")}
              onDragLeave={(e) => e.currentTarget.classList.remove("drop-target")}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("drop-target");
                const source = dragged.current;
                if (!source || source === project.id) return;
                setWorkspace((p) => {
                  const list = [...p.projects],
                    from = list.findIndex((s) => s.id === source),
                    to = list.findIndex((s) => s.id === project.id);
                  list.splice(to, 0, ...list.splice(from, 1));
                  return { ...p, projects: list };
                });
                dragged.current = null;
              }}
            >
              <button
                className="project-tab-name"
                onClick={() => {
                  setWorkspace((p) => ({ ...p, activeId: project.id }));
                  selectAnnotation(null);
                  setTool("pan");
                }}
              >
                <Moon size={13} />
                {project.name}
              </button>
              <button
                className="close-tab"
                aria-label={`Close ${project.name}`}
                onClick={() => closeProject(project.id)}
              >
                <X size={13} />
              </button>
            </motion.div>
          ))}
          </AnimatePresence>
          <button
            className="add-project"
            aria-label="New project"
            title="New project"
            onClick={() => setDialog("new")}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="dock-workspace">
          {hasProject ? <DockviewReact
            components={components}
            onReady={onReady}
            theme={themeAbyss}
          /> : <section className="empty-workspace" aria-labelledby="empty-title">
            <div className="empty-workspace-card">
              <span className="empty-workspace-mark" aria-hidden="true" />
              <h1 id="empty-title">No project is open</h1>
              <p className="empty-workspace-copy">Start a lunar site study from scratch, choose a template, or open a project you already have.</p>
              <div className="empty-workspace-actions">
                <button className="empty-primary" onClick={() => setDialog("new")}><FilePlus size={17} /> Create new project</button>
                <button onClick={() => setDialog("new")}><Plus size={17} /> Create from template</button>
                <button onClick={() => fileInput.current?.click()}><FolderOpen size={17} /> Open project</button>
              </div>
            </div>
          </section>}
        </div>
        <footer className="statusbar">
          <span
            className={`connection-dot ${a.error || b.error ? "error" : ""}`}
          />
          <span>
            {!hasProject ? "No project open"
            : a.pending || b.pending
              ? "Calculating…"
              : a.error || b.error
                ? "Geometry service error"
                : "Local SPICE ready"}
          </span>
          {hasProject && <span>MOON_ME / DE421</span>}
          <div className="background-tasks" aria-live="polite" aria-label="Background activity">
            {hasProject && (a.pending || b.pending) ? (
              <span className="background-task" key="geometry">
                <span>Geometry calculation</span><progress aria-label="Geometry calculation in progress" />
              </span>
            ) : null}
            {backgroundTasks.map((task) => (
              <span className="background-task" key={task.id} title={task.label}>
                <span>{task.label}</span><progress max={1} value={task.progress} />
              </span>
            ))}
          </div>
          <span className="status-spacer" />
          <span>
            {workspace.projects.length} project
            {workspace.projects.length === 1 ? "" : "s"} ·{" "}
            {hasProject ? `${study.satellites.length} satellites · ${study.annotations.length} annotations` : "Ready to create or open a lunar study"}
          </span>
          <button onClick={() => setDialog("help")}>
            Model & source notes
          </button>
        </footer>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept=".json,.lunar"
          multiple
          onChange={(e) => importFiles(e.target.files)}
        />
        <Toaster theme={preferences.theme} position="bottom-right" closeButton richColors duration={5000} />
        {dialog && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setDialog(null);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }
            }}
          >
            <section
              className={`modal ${dialog === "preferences" ? "preferences-modal" : ""}`}
              role="dialog"
              aria-modal="true"
                aria-label={
                dialog === "new"
                  ? "Create project"
                  : dialog === "preferences"
                    ? "Preferences"
                      : dialog === "preview" ? "PDF report preview" : "Help and workspace guide"
              }
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  const els = e.currentTarget.querySelectorAll<HTMLElement>(
                    "button,input,select,textarea,a[href]",
                  );
                  const first = els[0],
                    last = els[els.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <div className="modal-header">
                <h2>
                  {dialog === "new"
                    ? "Create a study"
                    : dialog === "preferences"
                      ? "Preferences"
                      : dialog === "preview" ? "Report preview" : "Help & workspace guide"}
                </h2>
                <button
                  autoFocus
                  aria-label="Close popup"
                  onClick={() => { setDialog(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                >
                  <X size={20} />
                </button>
              </div>
              {dialog === "new" ? (
                <NewStudy onCreate={addProject} />
              ) : dialog === "preferences" ? (
                <PreferencesPanel initial={preferencesSection} />
              ) : dialog === "preview" ? (
                previewUrl ? <iframe className="report-preview" title="PDF report preview" src={previewUrl} /> : <div className="report-preview-loading loading-surface" role="status"><span className="inline-loader" aria-hidden="true" /> Preparing report preview…</div>
              ) : (
                <HelpGuide startTour={startTour} />
              )}
            </section>
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
function NewStudy({ onCreate }: { onCreate: (s: Study) => void }) {
  const [draft, setDraft] = useState(() => createStudy()),
    [template, setTemplate] = useState("south");
  const update = (p: Partial<Study>) => setDraft((s) => ({ ...s, ...p }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isStudy(draft)) onCreate(draft);
      }}
    >
      <label className="field">
        <span>Template</span>
        <select
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            setDraft(createStudy(e.target.value));
          }}
        >
          <option value="south">South pole surface mission</option>
          <option value="apollo">Apollo region survey</option>
          <option value="traverse">Apollo traverse practice · stops and prohibited area</option>
          <option value="farside">Far side relay study · 2 satellites</option>
          <option value="blank">Blank study</option>
        </select>
      </label>
      <p className="hint">
        Presets are editable study coordinates, not approved landing sites.
        Choosing a template loads its complete setup below.
      </p>
      <label className="field">
        <span>Project name</span>
        <input
          autoFocus
          required
          maxLength={100}
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <div className="field-pair">
        <Numeric
          label="Latitude"
          unit="°"
          min={-90}
          max={90}
          value={draft.site.lat}
          onChange={(lat) =>
            update({
              site: { ...draft.site, lat },
              compareSite: { ...draft.compareSite, lat },
            })
          }
        />
        <Numeric
          label="Longitude E"
          unit="°"
          min={-180}
          max={180}
          value={draft.site.lon}
          onChange={(lon) =>
            update({
              site: { ...draft.site, lon },
              compareSite: { ...draft.compareSite, lon },
            })
          }
        />
      </div>
      <DateField
        label="Baseline start"
        value={draft.start}
        onChange={(start) =>
          update({
            start,
            compareStart: new Date(Date.parse(start) + 86400000).toISOString(),
          })
        }
      />
      <Numeric
        label="Mission duration"
        unit="hours"
        min={8}
        max={744}
        value={draft.duration}
        onChange={(duration) => update({ duration })}
      />
      <p className="hint">
        {draft.events.length} mission activities · {draft.satellites.length}{" "}
        planning satellites · comparison begins +24 h later.
      </p>
      <button className="primary create-submit" type="submit">
        <FilePlus size={16} />
        Create project
      </button>
    </form>
  );
}
