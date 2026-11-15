import { hosted } from "./runtime";
import { moonLayers, moonTileUrl } from "./moonTiles";
import { missionFrame, missionRoute, routePlayback } from "./missionPlayback";
import { aboveTerrain, renderedGroundHeight, terrainOverlays, visibleSurfaceMarker } from "./terrainOverlays";
import { clearsAvoidAreas } from "./routeAvoidance";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as C from "cesium";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useWorkspace } from "./WorkspaceContext";
import { createLunarTerrain, prefersImageMap } from "./lunarTerrain";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Crosshair,
  Compass,
  Globe,
  Hand,
  MapPin,
  Minus,
  NavigationArrow,
  Path,
  Polygon,
  Plus,
  Ruler,
  Sun,
  X,
} from "@phosphor-icons/react";
import { activeSite, cursorTime, rowAt, surfaceDistance, uid } from "./study";
import type { Annotation, Geometry, Study } from "./study";
import { isLowPerformanceDevice } from "./preferences";
export type MapActions = {
  requestRender: () => void;
  home: () => void;
  zoom: (inward: boolean) => void;
  site: () => void;
  north: () => void;
  south: () => void;
  toggleCompassAngle: () => void;
  screenshot: () => string;
  readyScreenshot: (timeoutMs?: number) => Promise<string>;
  captureViews: (site?: { lat: number; lon: number }, surfaceLayers?: Study["layer"][], timeoutMs?: number) => Promise<{ label: string; image: string }[]>;
  focus: (lon: number, lat: number, height?: number) => void;
  frameMission: (points: [number, number][]) => void;
  previewLanding: () => void;
  recordLanding: () => void;
  resetLanding: () => void;
};
export type MapTool = "pan" | "site" | "point" | "line" | "polygon" | "measure";
const R = 1737400;
const ellipsoid = new C.Ellipsoid(R, R, R);
const cart = (lon: number, lat: number, height = 100) =>
  C.Cartesian3.fromDegrees(lon, lat, height, ellipsoid);
const imageryProvider = (surfaceLayer: Study["layer"]) => {
  const layer = moonLayers[surfaceLayer];
  return new C.UrlTemplateImageryProvider({
    url: moonTileUrl(surfaceLayer, hosted, "{z}", "{y}", "{x}"),
    tilingScheme: new C.GeographicTilingScheme({
      ellipsoid,
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
    }),
    maximumLevel: layer.max,
    credit: "NASA/GSFC/ASU · LROC / LOLA · NASA/JPL Moon Trek",
  });
};
export default function MapView({
  study,
  geometry,
  compare,
  onChange,
  onAnnotation,
  actions,
  tool,
  setTool,
  onStatus,
}: {
  study: Study;
  geometry?: Geometry;
  compare?: Geometry;
  onChange: (p: Partial<Study>) => void;
  onAnnotation: (a: Annotation) => void;
  actions: React.RefObject<MapActions | null>;
  tool: MapTool;
  setTool: (t: MapTool) => void;
  onStatus: (s: string) => void;
}) {
  const { preferences, walkMode, setWalkMode, routeOverlay, pickRoutePoint, selectedAnnotation } = useWorkspace();
  const lowPerformanceDevice = isLowPerformanceDevice();
  const enhanced3d = preferences.hardware3d && !(preferences.performanceGuard && lowPerformanceDevice);
  const [autoImage, setAutoImage] = useState(prefersImageMap);
  const [terrainError, setTerrainError] = useState("");
  const [imageryFailed, setImageryFailed] = useState(false);
  const [imageryAttempt, setImageryAttempt] = useState(0);
  const imageMode = preferences.terrainMode === "image" || (preferences.terrainMode === "auto" && autoImage);
  const effectiveView = imageMode ? "2d" : study.view;
  const route = useMemo(() => routePlayback(missionRoute(
    study.annotations, study.prohibitedAreas, routeOverlay?.studyId === study.id ? routeOverlay : null, selectedAnnotation,
  )), [study.annotations, study.prohibitedAreas, study.id, routeOverlay, selectedAnnotation]);
  const pose = missionFrame(study, route);
  const mission = useRef(pose);
  const mapSite = activeSite(study);
  const result = study.active === "A" ? geometry : compare;
  const time = cursorTime(study);
  const row = useMemo(() => rowAt(result, time), [result, time]);
  const geometryRow = useRef(row);
  const [reducedDetail, setReducedDetail] = useState(false);
  const [compassAngle, setCompassAngle] = useState(false);
  const terrainQuality = reducedDetail ? "low" : preferences.terrainQuality;
  const container = useRef<HTMLDivElement>(null),
    viewer = useRef<C.Viewer | null>(null),
    surfaceLayerRef = useRef<C.ImageryLayer | null>(null),
    surfaceTransitionRef = useRef<{ frame: number; incoming: C.ImageryLayer; outgoing: C.ImageryLayer | null } | null>(null),
    starBlurStage = useRef<C.PostProcessStage | null>(null),
    starFadeStage = useRef<C.PostProcessStage | null>(null),
    starOpacity = useRef(0),
    state = useRef({ study, tool, onChange, onAnnotation, onStatus }),
    drawing = useRef<[number, number][]>([]);
  const lastSite = useRef(
    `${study.id}:${study.active}:${activeSite(study).lat}:${activeSite(study).lon}`,
  );
  const previousStarScenario = useRef(study.active);
  const compassCamera = useRef<{ position: C.Cartesian3; direction: C.Cartesian3; up: C.Cartesian3 } | null>(null);
  const rendererFaulted = useRef(false);
  const [toolPosition, setToolPosition] = useState({ x: 14, y: 70 });
  const tools = useRef<HTMLDivElement>(null);
  const mapSurface = useRef<HTMLDivElement>(null);
  const inputSurface = useRef<HTMLDivElement>(null);
  const landingProgressRef = useRef<number | null>(null);
  const landingRunner = useRef<(record: boolean, focused?: boolean) => void>(() => {});
  const landingPreparing = useRef(false);
  const landingReset = useRef<() => void>(() => {});
  const draftOverlay = useRef<ReturnType<typeof terrainOverlays> | null>(null);
  const landingFrame = useRef<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recorderChunks = useRef<Blob[]>([]);
  useLayoutEffect(() => {
    mission.current = pose;
    viewer.current?.scene.requestRender();
  }, [pose]);
  useLayoutEffect(() => {
    geometryRow.current = row;
    const v = viewer.current;
    if (!v || !row) return;
    const direction = C.Cartesian3.normalize(C.Cartesian3.fromArray(row.sun.vector), new C.Cartesian3());
    v.scene.light = new C.DirectionalLight({ direction: C.Cartesian3.negate(direction, direction), intensity: 2 });
    v.scene.requestRender();
  }, [row]);
  useEffect(() => {
    const area = mapSurface.current;
    const renderer = container.current;
    const input = inputSurface.current;
    if (!area || !renderer || !input) return;
    let frame = 0;
    let fadeFrame = 0;
    let hideTimer: number | undefined;
    let wasVisible: boolean | null = null;
    const resizeIfVisible = () => {
      const target = container.current;
      const activeViewer = viewer.current;
      if (!target || !activeViewer || activeViewer.isDestroyed()) return false;
      const rect = target.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      activeViewer.resize();
      activeViewer.scene.requestRender();
      return true;
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = area.getBoundingClientRect();
        const full = document.documentElement.dataset.mapGlassActive === "true";
        const visible = rect.width > 0 && rect.height > 0;
        Object.assign(renderer.style, {
          left: `${full ? 0 : rect.left}px`, top: `${full ? 0 : rect.top}px`,
          width: `${full ? window.innerWidth : rect.width}px`,
          height: `${full ? window.innerHeight : rect.height}px`,
        });
        if (visible) {
          if (hideTimer !== undefined) window.clearTimeout(hideTimer);
          hideTimer = undefined;
          renderer.style.display = "block";
          if (wasVisible !== true) {
            cancelAnimationFrame(fadeFrame);
            const animate = document.documentElement.dataset.animations !== "false" &&
              !matchMedia("(prefers-reduced-motion: reduce)").matches;
            renderer.style.opacity = animate ? "0" : "1";
            if (animate) fadeFrame = requestAnimationFrame(() => { renderer.style.opacity = "1"; });
          }
        } else if (wasVisible !== false) {
          cancelAnimationFrame(fadeFrame);
          renderer.style.opacity = "0";
          hideTimer = window.setTimeout(() => {
            renderer.style.display = "none";
          }, document.documentElement.dataset.animations === "false" ? 0 : 280);
        }
        wasVisible = visible;
        const activeViewer = viewer.current;
        if (activeViewer && !activeViewer.isDestroyed())
          activeViewer.useDefaultRenderLoop = visible && !rendererFaulted.current;
        if (visible && !rendererFaulted.current) resizeIfVisible();
      });
    };
    const resize = new ResizeObserver(sync);
    resize.observe(area);
    const attributes = new MutationObserver(sync);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-map-glass-active"] });
    window.addEventListener("resize", sync);
    const forward = (event: Event) => {
      const canvas = viewer.current?.canvas;
      if (!canvas) return;
      event.preventDefault(); event.stopPropagation();
      const clone = event instanceof WheelEvent ? new WheelEvent(event.type, event)
        : event instanceof PointerEvent ? new PointerEvent(event.type, event)
        : new MouseEvent(event.type, event as MouseEvent);
      canvas.dispatchEvent(clone);
    };
    const events = ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "dblclick", "contextmenu"];
    events.forEach((type) => input.addEventListener(type, forward, { passive: false }));
    sync();
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(fadeFrame); if (hideTimer !== undefined) window.clearTimeout(hideTimer); resize.disconnect(); attributes.disconnect(); window.removeEventListener("resize", sync); events.forEach((type) => input.removeEventListener(type, forward)); };
  }, []);
  useEffect(() => {
    const surface = inputSurface.current;
    if (!surface || !walkMode || !preferences.wasdNavigation) return;
    const v = viewer.current;
    const pressed = new Set<string>();
    const velocity = { east: 0, north: 0 };
    let frame = 0;
    let previousTime = 0;
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement &&
      target.matches("input, textarea, select, [contenteditable='true']");
    const schedule = () => { if (!frame) frame = requestAnimationFrame(step); };
    const step = (now: number) => {
      frame = 0;
      const map = viewer.current;
      if (!map || map.isDestroyed()) return;
      const delta = previousTime ? Math.min(0.05, (now - previousTime) / 1000) : 1 / 60;
      previousTime = now;
      const forward = (pressed.has("KeyW") ? 1 : 0) - (pressed.has("KeyS") ? 1 : 0);
      const sideways = (pressed.has("KeyD") ? 1 : 0) - (pressed.has("KeyA") ? 1 : 0);
      let east = 0;
      let north = 0;
      // Cesium may report an undefined heading while the camera looks straight
      // down. A NaN heading poisons the direction vector and silently ends the
      // animation loop, so keep north as the stable fallback in that case.
      const cameraHeading = map.camera.heading;
      const heading = Number.isFinite(cameraHeading) ? cameraHeading : 0;
      // WASD follows the camera's horizontal heading; diagonals keep the same speed.
      east = Math.sin(heading) * forward + Math.cos(heading) * sideways;
      north = Math.cos(heading) * forward - Math.sin(heading) * sideways;
      const directionLength = Math.hypot(east, north);
      if (directionLength > 0) { east /= directionLength; north /= directionLength; }
      const position = map.camera.positionCartographic;
      if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) || !Number.isFinite(position.height)) {
        velocity.east = 0;
        velocity.north = 0;
        previousTime = 0;
        return;
      }
      const targetSpeed = directionLength > 0
        ? C.Math.clamp(Math.max(0, position.height) * 0.18, 24, 90000) * (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? 2.5 : 1)
        : 0;
      const targetEast = east * targetSpeed;
      const targetNorth = north * targetSpeed;
      // Ease velocity toward the held keys, and coast gently to rest on release.
      const response = 1 - Math.exp(-delta / (targetSpeed ? 0.16 : 0.12));
      velocity.east += (targetEast - velocity.east) * response;
      velocity.north += (targetNorth - velocity.north) * response;
      if (Math.hypot(velocity.east, velocity.north) > 0.35) {
        const latitude = C.Math.clamp(
          position.latitude + velocity.north * delta / R,
          -Math.PI / 2 + 0.002,
          Math.PI / 2 - 0.002,
        );
        const longitude = position.longitude + velocity.east * delta / (R * Math.max(0.08, Math.cos(latitude)));
        map.camera.setView({
          destination: C.Cartesian3.fromRadians(longitude, latitude, position.height, ellipsoid),
          orientation: { heading: map.camera.heading, pitch: map.camera.pitch, roll: map.camera.roll },
        });
        map.scene.requestRender();
        schedule();
      } else {
        velocity.east = 0;
        velocity.north = 0;
        previousTime = 0;
      }
    };
    const move = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pressed.clear();
        setWalkMode(false);
        return;
      }
      if (!["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) pressed.add(event.code);
      schedule();
    };
    const release = (event: KeyboardEvent) => {
      if (pressed.delete(event.code) && pressed.size === 0) schedule();
    };
    const clear = () => { pressed.clear(); schedule(); };
    const focusMap = () => {
      if (walkMode && preferences.wasdNavigation) requestAnimationFrame(() => surface.focus({ preventScroll: true }));
    };
    if (v && !v.isDestroyed()) v.scene.morphTo3D(0.18);
    // Capture at window level: Dockview and menu focus changes can otherwise
    // leave the map's overlay without keyboard focus while Moon walk is active.
    window.addEventListener("keydown", move, true);
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    focusMap();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", move, true);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [walkMode, preferences.wasdNavigation]);
  useEffect(() => {
    const area = mapSurface.current;
    if (!area) return;
    const observer = new ResizeObserver(() => {
      setToolPosition(pos => {
        const next = {
          x: Math.max(0, Math.min(pos.x, area.clientWidth - (tools.current?.offsetWidth || 48) - 8)),
          y: Math.max(0, Math.min(pos.y, area.clientHeight - 96)),
        };
        return next.x === pos.x && next.y === pos.y ? pos : next;
      });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const [points, setPoints] = useState(0),
    [measureDistance, setMeasureDistance] = useState(0),
    [mapError, setMapError] = useState(""),
    [tiles, setTiles] = useState("Loading NASA imagery…");
  state.current = { study, tool, onChange, onAnnotation, onStatus };
  const finish = () => {
    const coords = drawing.current;
    const kind = tool === "polygon" ? "polygon" : "line";
    if (coords.length < (kind === "polygon" ? 3 : 2)) {
      onStatus(`Add at least ${kind === "polygon" ? 3 : 2} points on the map.`);
      return;
    }
    const distance = coords
      .slice(1)
      .reduce((v, c, i) => v + surfaceDistance(coords[i], c), 0);
    onAnnotation({
      id: uid(),
      kind,
      name:
        tool === "measure"
          ? `Distance ${distance.toFixed(2)} km`
          : kind === "polygon"
            ? "Study region"
            : "Surface traverse",
      note:
        tool === "measure"
          ? `Measured lunar surface distance: ${distance.toFixed(3)} km`
          : kind === "line"
            ? `Traverse length along the lunar sphere: ${distance.toFixed(3)} km`
            : "Lunar body-fixed study boundary",
      color: "#67b1ff",
      coordinates: [...coords],
    });
    drawing.current = [];
    setPoints(0);
    setMeasureDistance(0);
    setTool("pan");
  };
  useEffect(() => {
    if (!container.current) return;
    C.Ellipsoid.default = ellipsoid;
    let v: C.Viewer;
    try {
      v = new C.Viewer(container.current, {
        ellipsoid,
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        skyAtmosphere: false,
        skyBox: false,
        globe: new C.Globe(ellipsoid),
        mapProjection: new C.GeographicProjection(ellipsoid),
        terrainProvider: new C.EllipsoidTerrainProvider({ ellipsoid }),
        sceneMode: C.SceneMode.SCENE3D,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        showRenderLoopErrors: false,
      });
      viewer.current = v;
      const renderError = (_scene: C.Scene, error: unknown) => {
        rendererFaulted.current = true;
        v.useDefaultRenderLoop = false;
        setMapError(error instanceof Error ? error.message : "Cesium stopped after a rendering error");
      };
      v.scene.renderError.addEventListener(renderError);
      v.scene.backgroundColor = C.Color.fromCssColorString("#091426");
      const softFocus = new C.PostProcessStage({
        name: "luna-star-soft-focus",
        fragmentShader: `
          uniform sampler2D colorTexture;
          uniform sampler2D depthTexture;
          in vec2 v_textureCoordinates;
          uniform float radius;
          uniform vec2 pixelSize;
          void main() {
            vec4 center = texture(colorTexture, v_textureCoordinates);
            if (czm_readDepth(depthTexture, v_textureCoordinates) < 0.999999 || radius <= 0.0) {
              out_FragColor = center;
              return;
            }
            vec2 d = pixelSize * radius;
            vec4 soft = center * 0.2;
            soft += texture(colorTexture, v_textureCoordinates + vec2(d.x, 0.0)) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates - vec2(d.x, 0.0)) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates + vec2(0.0, d.y)) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates - vec2(0.0, d.y)) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates + d) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates - d) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates + vec2(d.x, -d.y)) * 0.1;
            soft += texture(colorTexture, v_textureCoordinates + vec2(-d.x, d.y)) * 0.1;
            out_FragColor = soft;
          }`,
        uniforms: {
          radius: () => state.current.study.starBlur ?? 0,
          pixelSize: () => new C.Cartesian2(1 / v.canvas.width, 1 / v.canvas.height),
        },
      });
      v.scene.postProcessStages.add(softFocus);
      starBlurStage.current = softFocus;
      const starFade = new C.PostProcessStage({
        name: "luna-fade-star-sky",
        fragmentShader: `#version 300 es
          uniform sampler2D colorTexture;
          uniform sampler2D depthTexture;
          uniform float opacity;
          in vec2 v_textureCoordinates;
          void main() {
            vec4 color = texture(colorTexture, v_textureCoordinates);
            float depth = czm_readDepth(depthTexture, v_textureCoordinates);
            if (depth >= 0.999999) color.rgb *= opacity;
            out_FragColor = color;
          }`,
        uniforms: { opacity: () => starOpacity.current },
      });
      v.scene.postProcessStages.add(starFade);
      starFadeStage.current = starFade;
      v.scene.globe.baseColor = C.Color.fromCssColorString("#29394c");
      v.scene.globe.showGroundAtmosphere = false;
      v.scene.screenSpaceCameraController.minimumZoomDistance = 50;
      v.scene.screenSpaceCameraController.maximumZoomDistance = 15000000;
      v.scene.globe.maximumScreenSpaceError = 2;
      v.scene.globe.tileCacheSize = 250;
      v.resolutionScale = Math.min(devicePixelRatio, 1.5);
      v.cesiumWidget.creditContainer.classList.add("moon-credits");
      const fly = (lon: number, lat: number, height = 1400000) => {
        v.camera.flyTo({
          destination: aboveTerrain(v.scene, [lon, lat], height),
          duration:
            document.documentElement.style.getPropertyValue(
              "--camera-animation",
            ) === "0"
              ? 0
              : 0.65,
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        });
      };
      const readyScreenshot = async (timeoutMs = 15000) => {
        const rect = container.current?.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2)
          throw new Error("Map is hidden or has no display size; open the map before capturing imagery.");
        v.resize();
        v.scene.requestRender();
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const until = Date.now() + Math.max(0, timeoutMs);
        while (!v.scene.globe.tilesLoaded && Date.now() < until) {
          v.scene.requestRender();
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!v.scene.globe.tilesLoaded)
          throw new Error(
            "Map imagery is still loading. Wait for the map, or turn map images off in Report setup.",
          );
        if (v.canvas.width < 2 || v.canvas.height < 2)
          throw new Error(
            "Map is hidden or has no size; open the map before exporting.",
          );
        v.scene.render();
        await new Promise((r) => requestAnimationFrame(r));
        return v.canvas.toDataURL("image/png");
      };
      actions.current = {
        requestRender: () => v.scene.requestRender(),
        readyScreenshot,
        zoom: (inward) => {
          const camera = v.camera.positionCartographic;
          const ground = v.scene.mode === C.SceneMode.SCENE3D
            ? renderedGroundHeight(v.scene, C.Math.toDegrees(camera.longitude), C.Math.toDegrees(camera.latitude))
            : 0;
          const distance = Math.max(50, camera.height - ground) * .4;
          if (inward) v.camera.zoomIn(distance);
          else v.camera.zoomOut(distance);
          v.scene.requestRender();
        },
        home: () => {
          const frustum = v.camera.frustum as C.PerspectiveFrustum;
          const canvasRect = v.canvas.getBoundingClientRect();
          const mapRect = mapSurface.current?.getBoundingClientRect();
          const fovy = frustum.fovy || 0.5;
          const width = Math.max(1, canvasRect.width);
          const height = Math.max(1, canvasRect.height);
          const mapWidth = Math.max(1, Math.min(width, mapRect?.width || width));
          const mapHeight = Math.max(1, Math.min(height, mapRect?.height || height));
          const fitScale = Math.min(mapWidth / width, mapHeight / height);
          const distance = (R / Math.sin(fovy / 2) * 1.35) / fitScale;
          const cameraHeight = Math.max(5000000, distance - R);
          const cameraPosition = aboveTerrain(v.scene, [0, 0], cameraHeight);
          let destination = cameraPosition;

          // The glass renderer fills the window, but the map panel is the
          // viewport users see. Shift the camera in its local east/north plane
          // so the globe's projected center lands at the panel's center.
          if (mapRect && canvasRect.width > 1 && canvasRect.height > 1) {
            const dx = mapRect.left + mapRect.width / 2 - (canvasRect.left + width / 2);
            const dy = mapRect.top + mapRect.height / 2 - (canvasRect.top + height / 2);
            const metersPerPixel = 2 * (R + cameraHeight) * Math.tan(fovy / 2) / height;
            const frame = C.Transforms.eastNorthUpToFixedFrame(cart(0, 0, 0), ellipsoid);
            const east = C.Cartesian3.fromElements(frame[0], frame[1], frame[2]);
            const north = C.Cartesian3.fromElements(frame[4], frame[5], frame[6]);
            const eastShift = C.Cartesian3.multiplyByScalar(east, -dx * metersPerPixel, new C.Cartesian3());
            const northShift = C.Cartesian3.multiplyByScalar(north, dy * metersPerPixel, new C.Cartesian3());
            const shift = C.Cartesian3.add(eastShift, northShift, new C.Cartesian3());
            destination = C.Cartesian3.add(cameraPosition, shift, new C.Cartesian3());
          }

          // Clear any projection offsets left by earlier views so the camera
          // uses the same centered perspective for its next interaction.
          frustum.xOffset = 0;
          frustum.yOffset = 0;
          v.camera.flyTo({
            destination,
            duration:
              document.documentElement.style.getPropertyValue("--camera-animation") === "0"
                ? 0
                : 0.65,
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          });
        },
        site: () => {
          const s = activeSite(state.current.study);
          const rect = container.current?.getBoundingClientRect();
          const aspect = rect && rect.height > 0 ? rect.width / rect.height : 1.5;
          const height = C.Math.clamp(185000 / Math.sqrt(Math.max(.55, aspect)), 125000, 230000);
          fly(s.lon, s.lat, height);
        },
        toggleCompassAngle: () => {
          const camera = v.camera;
          const duration = document.documentElement.style.getPropertyValue("--camera-animation") === "0" ? 0 : .65;
          if (compassCamera.current) {
            const previous = compassCamera.current;
            compassCamera.current = null;
            setCompassAngle(false);
            camera.flyTo({
              destination: previous.position,
              orientation: { direction: previous.direction, up: previous.up },
              duration,
              complete: () => v.scene.requestRender(),
            });
            return;
          }
          compassCamera.current = {
            position: C.Cartesian3.clone(camera.positionWC),
            direction: C.Cartesian3.clone(camera.directionWC),
            up: C.Cartesian3.clone(camera.upWC),
          };
          setCompassAngle(true);
          camera.flyTo({
            destination: C.Cartesian3.clone(camera.positionWC),
            orientation: { heading: 0, pitch: -1.08, roll: 0 },
            duration,
            complete: () => v.scene.requestRender(),
          });
        },
        north: () => fly(0, 89.9, 2600000),
        south: () => fly(0, -89.9, 2600000),
        focus: (lon, lat, height) => {
          const rect = container.current?.getBoundingClientRect();
          const aspect = rect && rect.height > 0 ? rect.width / rect.height : 1.5;
          const fitHeight = height ?? C.Math.clamp(185000 / Math.sqrt(Math.max(.55, aspect)), 125000, 230000);
          fly(lon, lat, fitHeight);
        },
        frameMission: (points) => {
          if (!points.length || v.scene.mode !== C.SceneMode.SCENE3D) return;
          const camera = v.camera.positionCartographic;
          const localHeight = renderedGroundHeight(v.scene, C.Math.toDegrees(camera.longitude), C.Math.toDegrees(camera.latitude));
          if (camera.height - localHeight < 100000) return;
          const footprint = C.BoundingSphere.fromPoints(points.map(point => aboveTerrain(v.scene, point, 0)));
          v.camera.flyToBoundingSphere(footprint, {
            offset: new C.HeadingPitchRange(0, -C.Math.PI_OVER_THREE, Math.max(30000, footprint.radius * 4)),
            duration: document.documentElement.style.getPropertyValue("--camera-animation") === "0" ? 0 : .6,
          });
        },
        previewLanding: () => landingRunner.current(false),
        recordLanding: () => landingRunner.current(true),
        resetLanding: () => landingReset.current(),
        captureViews: async (target, surfaceLayers, timeoutMs = 15000) => {
          const mode = v.scene.mode,
            transform = C.Matrix4.clone(v.camera.transform),
            position = C.Cartesian3.clone(v.camera.position),
            direction = C.Cartesian3.clone(v.camera.direction),
            up = C.Cartesian3.clone(v.camera.up),
            frustum = v.camera.frustum.clone();
          const images: { label: string; image: string }[] = [];
          const point = target || activeSite(state.current.study);
          const originalLayer = state.current.study.layer;
          try {
            v.camera.cancelFlight();
            if (v.scene.mode !== C.SceneMode.SCENE3D) v.scene.morphTo3D(0);
            if (surfaceLayers?.length) {
              const aspect = Math.max(0.1, v.canvas.width / Math.max(1, v.canvas.height));
              const fov = (v.camera.frustum as C.PerspectiveFrustum).fov || Math.PI / 3;
              const verticalFov = aspect > 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect) : fov;
              const viewHeight = Math.max(18000, Math.min(95000, (R * 0.42) / Math.tan(verticalFov / 2)));
              for (const surfaceLayer of surfaceLayers) {
                v.imageryLayers.removeAll();
                v.imageryLayers.addImageryProvider(imageryProvider(surfaceLayer));
                v.camera.setView({
                  destination: cart(point.lon, point.lat, viewHeight),
                  orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
                });
                const captured = await readyScreenshot(timeoutMs);
                images.push({
                  label: `${surfaceLayer} terrain map - ${point.lat.toFixed(6)} deg latitude, ${point.lon.toFixed(6)} deg east longitude; ${cursorTime(state.current.study)}; NASA Moon Trek/LOLA layer, displayed resolution may be coarser than its native source.`,
                  image: captured,
                });
              }
              return images;
            }
            const aspect = Math.max(
              0.1,
              v.canvas.width / Math.max(1, v.canvas.height),
            );
            const fov =
              (v.camera.frustum as C.PerspectiveFrustum).fov || Math.PI / 3;
            const verticalFov =
              aspect > 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect) : fov;
            const wholeMoonRange = (R / Math.sin(verticalFov / 2)) * 1.3 - R;
            for (const [label, lon, lat, height, pitch] of [
              [
                "Whole Moon",
                point.lon,
                point.lat,
                Math.max(6500000, wholeMoonRange),
                -Math.PI / 2,
              ],
              ["Local overhead", point.lon, point.lat, 60000, -Math.PI / 2],
              ["Local oblique", point.lon, point.lat, 100000, -Math.PI / 3],
            ] as [string, number, number, number, number][]) {
              if (label === "Local oblique") {
                v.camera.lookAt(
                  cart(lon, lat, 0),
                  new C.HeadingPitchRange(0, pitch, height),
                );
                v.camera.lookAtTransform(C.Matrix4.IDENTITY);
              } else
                v.camera.setView({
                  destination: cart(lon, lat, height),
                  orientation: { heading: 0, pitch, roll: 0 },
                });
              v.scene.requestRender();
              const captured = await readyScreenshot(timeoutMs);
              images.push({
                label: `${label} - ${point.lat.toFixed(6)} deg N, ${point.lon.toFixed(6)} deg E. ${cursorTime(state.current.study)}; available cached imagery.`,
                image: captured,
              });
            }
          } finally {
            if (surfaceLayers?.length) {
              v.imageryLayers.removeAll();
              v.imageryLayers.addImageryProvider(imageryProvider(originalLayer));
            }
            if (mode === C.SceneMode.SCENE2D) v.scene.morphTo2D(0);
            else if (mode === C.SceneMode.COLUMBUS_VIEW)
              v.scene.morphToColumbusView(0);
            v.camera.lookAtTransform(transform);
            v.camera.frustum = frustum;
            C.Cartesian3.clone(position, v.camera.position);
            C.Cartesian3.clone(direction, v.camera.direction);
            C.Cartesian3.clone(up, v.camera.up);
            v.scene.requestRender();
          }
          return images;
        },
        screenshot: () => {
          v.scene.render();
          return v.canvas.toDataURL("image/png");
        },
      };
      v.camera.setView({ destination: cart(-20, -38, 4800000) });
      const handler = new C.ScreenSpaceEventHandler(v.canvas);
      handler.setInputAction((event: { position: C.Cartesian2 }) => {
        const ray = v.camera.getPickRay(event.position);
        const pick = ray ? v.scene.globe.pick(ray, v.scene) : undefined;
        if (!pick) return;
        const coord = ellipsoid.cartesianToCartographic(pick);
        const lon = C.Math.toDegrees(coord.longitude),
          lat = C.Math.toDegrees(coord.latitude);
        const st = state.current;
        const pair: [number, number] = [lon, lat];
        if (pickRoutePoint(pair)) return;
        if (st.tool === "site") {
          const site = {
            ...activeSite(st.study),
            lat,
            lon,
            name: "Custom study point",
          };
          st.onChange(
            st.study.active === "A" ? { site } : { compareSite: site },
          );
          st.onStatus(`Study point: ${lat.toFixed(5)}°, ${lon.toFixed(5)}° E`);
        } else if (st.tool === "point") {
          st.onAnnotation({
            id: uid(),
            kind: "point",
            name: `Note ${st.study.annotations.length + 1}`,
            note: "",
            color: "#67b1ff",
            coordinates: [pair],
          });
        } else if (["line", "polygon", "measure"].includes(st.tool)) {
          drawing.current.push(pair);
          setPoints(drawing.current.length);
          setMeasureDistance(
            drawing.current.slice(1).reduce(
              (sum, point, index) => sum + surfaceDistance(drawing.current[index], point),
              0,
            ),
          );
          draftOverlay.current?.destroy();
          draftOverlay.current = terrainOverlays(v);
          draftOverlay.current.line(drawing.current, 2, C.Color.CYAN);
          v.scene.requestRender();
          st.onStatus(
            `${drawing.current.length} point(s) · use Finish to save`,
          );
        }
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      // Chromium/WebKit trackpad pinch emits ctrl+wheel. Keep ordinary wheel handling in Cesium.
      const pinch = (event: WheelEvent) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const scale = Math.min(
          0.4,
          Math.abs(event.deltaY) *
            0.012 *
            (Number(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--pinch-sensitivity",
              ),
            ) || 1),
        );
        const distance =
          Math.max(50, v.camera.positionCartographic.height) * scale;
        if (event.deltaY < 0) v.camera.zoomIn(distance);
        else v.camera.zoomOut(distance);
        v.scene.requestRender();
      };
      v.canvas.addEventListener("wheel", pinch, {
        passive: false,
        capture: true,
      });
      let gestureScale = 1;
      const gestureStart = (event: Event) => {
        event.preventDefault();
        gestureScale = 1;
      };
      const gestureChange = (event: Event) => {
        event.preventDefault();
        const scale = Number((event as unknown as { scale: number }).scale);
        if (!Number.isFinite(scale) || scale <= 0) return;
        const delta =
          (scale / gestureScale - 1) *
          Math.max(50, v.camera.positionCartographic.height);
        if (delta > 0) v.camera.zoomIn(delta);
        else v.camera.zoomOut(-delta);
        gestureScale = scale;
        v.scene.requestRender();
      };
      const contextLost = (event: Event) => {
        event.preventDefault();
        rendererFaulted.current = true;
        v.useDefaultRenderLoop = false;
        setMapError("Graphics context was lost. The map will retry when the renderer is restored.");
      };
      const contextRestored = () => {
        const rect = container.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0 && !v.isDestroyed()) {
          try { rendererFaulted.current = false; v.resize(); v.useDefaultRenderLoop = true; v.scene.requestRender(); setMapError(""); }
          catch (error) { setMapError(error instanceof Error ? error.message : "Map renderer could not recover"); }
        }
      };
      v.canvas.addEventListener("webglcontextlost", contextLost, false);
      v.canvas.addEventListener("webglcontextrestored", contextRestored, false);
      v.canvas.addEventListener("gesturestart", gestureStart, {
        passive: false,
      });
      v.canvas.addEventListener("gesturechange", gestureChange, {
        passive: false,
      });
      const resize = new ResizeObserver(() => {
        const rect = container.current?.getBoundingClientRect();
        if (!rect || rect.width < 1 || rect.height < 1 || v.isDestroyed()) return;
        v.resize();
        v.scene.requestRender();
      });
      resize.observe(container.current);
      return () => {
        v.canvas.removeEventListener("wheel", pinch, { capture: true });
        v.canvas.removeEventListener("gesturestart", gestureStart);
        v.canvas.removeEventListener("gesturechange", gestureChange);
        v.canvas.removeEventListener("webglcontextlost", contextLost, false);
        v.canvas.removeEventListener("webglcontextrestored", contextRestored, false);
        v.scene.renderError.removeEventListener(renderError);
        resize.disconnect();
        handler.destroy();
        actions.current = null;
        viewer.current = null;
        draftOverlay.current?.destroy();
        draftOverlay.current = null;
        v.destroy();
      };
    } catch (e) {
      setMapError(
        e instanceof Error ? e.message : "WebGL could not initialize",
      );
    }
  }, []);
  useEffect(() => {
    setAutoImage(prefersImageMap()); setReducedDetail(false);
  }, [preferences.terrainMode, preferences.terrainQuality]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let disposed = false;
    setTerrainError("");
    const quality = terrainQuality === "high" ? { error: 1.5, scale: 1.5, cache: 180, level: 14 }
      : terrainQuality === "low" ? { error: 6, scale: .85, cache: 60, level: 8 }
      : { error: 3, scale: 1.15, cache: 110, level: 12 };
    v.scene.globe.maximumScreenSpaceError = quality.error;
    v.scene.globe.tileCacheSize = quality.cache;
    v.resolutionScale = imageMode ? Math.min(1, devicePixelRatio) : Math.min(devicePixelRatio, quality.scale);
    v.scene.globe.depthTestAgainstTerrain = !imageMode;
    v.terrainProvider = (hosted || imageMode) ? new C.EllipsoidTerrainProvider({ ellipsoid }) : createLunarTerrain(ellipsoid, quality.level, (message) => {
      if (disposed || v.isDestroyed()) return;
      setTerrainError(message);
      v.terrainProvider = new C.EllipsoidTerrainProvider({ ellipsoid });
      v.scene.requestRender();
    });
    v.scene.requestRender();
    return () => { disposed = true; };
  }, [imageMode, terrainQuality, preferences.terrainMode]);
  useEffect(() => {
    const v = viewer.current; if (!v) return;
    v.scene.verticalExaggeration = imageMode ? 1 : preferences.terrainExaggeration;
    v.scene.verticalExaggerationRelativeHeight = 0;
    v.scene.requestRender();
  }, [imageMode, preferences.terrainExaggeration]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || hosted || !preferences.adaptiveTerrain || imageMode) return;
    let previous = 0, total = 0, count = 0, moving = false;
    const removeStart = v.camera.moveStart.addEventListener(() => { moving = true; previous = 0; });
    const removeEnd = v.camera.moveEnd.addEventListener(() => { moving = false; total = 0; count = 0; });
    const removeFrame = v.scene.postRender.addEventListener(() => {
      const now = performance.now(), elapsed = now - previous; previous = now;
      // Count only continuous camera motion, excluding idle request-render gaps.
      if (!moving || elapsed < 5 || elapsed > 1000 || v.scene.globe.tilesLoaded === false) { total = 0; count = 0; return; }
      total += elapsed; count++;
      if (count >= 30) {
        if (1000 * count / total < 24) {
          if (terrainQuality !== "low") setReducedDetail(true);
          else if (preferences.terrainMode === "auto") setAutoImage(true);
        }
        total = 0; count = 0;
      }
    });
    return () => { removeFrame(); removeStart(); removeEnd(); };
  }, [imageMode, terrainQuality, preferences.adaptiveTerrain, preferences.terrainMode]);
  useEffect(() => {
    drawing.current = [];
    setPoints(0);
    draftOverlay.current?.destroy();
    draftOverlay.current = null;
  }, [tool, study.id]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    setTiles("Loading NASA imagery…");
    setImageryFailed(false);
    // If a previous crossfade was interrupted, keep its incoming layer as the
    // current surface so a rapid selection change never flashes to the globe.
    const previousTransition = surfaceTransitionRef.current;
    if (previousTransition) {
      cancelAnimationFrame(previousTransition.frame);
      if (previousTransition.outgoing && v.imageryLayers.contains(previousTransition.outgoing))
        v.imageryLayers.remove(previousTransition.outgoing, true);
      previousTransition.incoming.alpha = 1;
      surfaceLayerRef.current = previousTransition.incoming;
      surfaceTransitionRef.current = null;
    }
    const outgoing = surfaceLayerRef.current;
    const provider = imageryProvider(study.layer);
    const incoming = v.imageryLayers.addImageryProvider(provider);
    incoming.alpha = 0;
    let failed = false;
    const removeError = provider.errorEvent.addEventListener(() => {
      failed = true;
      setImageryFailed(true);
      setTiles("Some NASA tiles are unavailable");
    });
    const remove = v.scene.globe.tileLoadProgressEvent.addEventListener(
      (count: number) => {
        if (count === 0 && !failed)
          setTiles(
            hosted ? "NASA Moon Trek" : "Local tile cache · detail limited to downloaded/source levels",
          );
      },
    );
    v.scene.requestRender();
    let cancelled = false;
    let fadeFrame = 0;
    let readyTimer: number | undefined;
    let fadeStarted = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.animations === "false";
    const beginFade = () => {
      if (cancelled || fadeStarted || v.isDestroyed()) return;
      fadeStarted = true;
      if (reduced) {
        incoming.alpha = 1;
        if (outgoing && v.imageryLayers.contains(outgoing)) v.imageryLayers.remove(outgoing, true);
        surfaceLayerRef.current = incoming;
        v.scene.requestRender();
        return;
      }
      const start = performance.now();
      const duration = outgoing ? 900 : 650;
      const startIncoming = incoming.alpha;
      const startOutgoing = outgoing?.alpha ?? 0;
      const tick = (now: number) => {
        if (cancelled || v.isDestroyed()) return;
        const progress = Math.min(1, (now - start) / duration);
        const eased = progress * progress * (3 - 2 * progress);
        incoming.alpha = startIncoming + (1 - startIncoming) * eased;
        if (outgoing && v.imageryLayers.contains(outgoing)) outgoing.alpha = startOutgoing * (1 - eased);
        v.scene.requestRender();
        if (progress < 1) {
          fadeFrame = requestAnimationFrame(tick);
          surfaceTransitionRef.current = { frame: fadeFrame, incoming, outgoing };
        } else {
          if (outgoing && v.imageryLayers.contains(outgoing)) v.imageryLayers.remove(outgoing, true);
          surfaceLayerRef.current = incoming;
          surfaceTransitionRef.current = null;
        }
      };
      fadeFrame = requestAnimationFrame(tick);
      surfaceTransitionRef.current = { frame: fadeFrame, incoming, outgoing };
    };
    const removeReady = incoming.readyEvent.addEventListener(() => {
      // Let Cesium request the first visible tiles before beginning the blend.
      readyTimer = window.setTimeout(beginFade, 120);
    });
    if (incoming.ready) readyTimer = window.setTimeout(beginFade, 120);
    return () => {
      cancelled = true;
      cancelAnimationFrame(fadeFrame);
      if (readyTimer !== undefined) window.clearTimeout(readyTimer);
      removeReady();
      removeError();
      remove();
      if (!v.isDestroyed() && v.imageryLayers.contains(incoming)) {
        incoming.alpha = 1;
        if (outgoing && v.imageryLayers.contains(outgoing)) v.imageryLayers.remove(outgoing, true);
        surfaceLayerRef.current = incoming;
      }
      if (surfaceTransitionRef.current?.incoming === incoming) surfaceTransitionRef.current = null;
    };
  }, [study.layer, imageryAttempt]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (effectiveView === "2d") v.scene.morphTo2D(0);
    else if (effectiveView === "oblique") v.scene.morphToColumbusView(0);
    else v.scene.morphTo3D(0);
    if (!v.scene.skyBox) v.scene.skyBox = C.SkyBox.createEarthSkyBox();
    const target = effectiveView === "3d" && !!study.stars ? 1 : 0;
    let frame = 0;
    let cancelled = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = (opacity: number) => {
      starOpacity.current = opacity;
      if (v.scene.skyBox) v.scene.skyBox.show = opacity > 0.001;
      if (starFadeStage.current) starFadeStage.current.enabled = opacity > 0.001;
      if (starBlurStage.current) starBlurStage.current.enabled = opacity > 0 && (study.starBlur || 0) > 0;
      v.scene.requestRender();
    };
    const fade = (to: number, duration: number, done?: () => void) => {
      const from = starOpacity.current;
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - start) / duration);
        // Smoothstep avoids a visible start/stop when the sky fades over the
        // lunar horizon and gives scenario changes a deliberate, soft cadence.
        const eased = progress * progress * (3 - 2 * progress);
        paint(from + (to - from) * eased);
        if (progress < 1) frame = requestAnimationFrame(tick);
        else done?.();
      };
      if (duration <= 0) { paint(to); done?.(); }
      else frame = requestAnimationFrame(tick);
    };
    const changedScenario = previousStarScenario.current !== study.active;
    previousStarScenario.current = study.active;
    if (preferences.animations && !reduced && changedScenario && target > 0) {
      fade(0, 520, () => fade(1, 820));
    } else if (preferences.animations && !reduced && starOpacity.current !== target) {
      fade(target, 720);
    } else paint(target);
    v.scene.requestRender();
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [effectiveView, study.active, study.stars, study.starBlur, preferences.animations]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.scene.globe.enableLighting = study.lighting;
    v.scene.requestRender();
  }, [study.lighting]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const overlays = terrainOverlays(v);
    const colors = ["#67b1ff", "#c6a5ff"];
    const sharedSite = study.site.lat === study.compareSite.lat && study.site.lon === study.compareSite.lon;
    [study.site, study.compareSite].forEach((s, i) => {
      const active = study.active === (i === 0 ? "A" : "B");
      if (sharedSite && !active) return;
      overlays.mark([s.lon, s.lat], {
        id: `site-${i}`,
        point: {
          pixelSize: active ? 11 : 7,
          color: C.Color.fromCssColorString(colors[i]),
          outlineColor: C.Color.WHITE,
          outlineWidth: 1,
        },
        label: {
          text: `${sharedSite ? "A/B" : i === 0 ? "A" : "B"} · ${s.name}`,
          font: "12px sans-serif",
          fillColor: C.Color.WHITE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString("#14233bdc"),
          pixelOffset: new C.Cartesian2(10, i === 0 ? -20 : 8),
          horizontalOrigin: C.HorizontalOrigin.LEFT,
        },
      }, 18, () => !active || (!mission.current.flight && landingProgressRef.current === null));
    });
    const search = study.siteSearch;
    const regionMatches = search?.area_scope !== "region" || study.annotations.some(annotation =>
      annotation.kind === "polygon" && annotation.id === search.region_id
      && JSON.stringify(annotation.coordinates) === JSON.stringify(search.region));
    if (study.showRecommendations && study.siteSearch && regionMatches) {
      const measuredPass = (candidate: NonNullable<Study["siteSearch"]>["candidates"][number]) =>
        (candidate.terrain_unknown_hours ?? 0) <= 1e-7 &&
        candidate.meets_sun_contact_thresholds === true &&
        candidate.station_access_hours !== null &&
        candidate.joint_sun_station_hours !== null &&
        candidate.landing.status === "screen-within-threshold";
      const allCandidates = [
        ...(study.siteSearch.same_date_candidates || study.siteSearch.candidates).filter(measuredPass),
        ...(study.siteSearch.date_candidates || []).filter(measuredPass),
      ];
      for (const c of allCandidates) {
        const qualified =
          c.better_sunlight && c.landing.status === "screen-within-threshold";
        const color = qualified
          ? C.Color.LIME
          : c.better_sunlight || c.reference_plane_better
            ? C.Color.GOLD
            : C.Color.GRAY;
        overlays.mark([c.lon, c.lat], {
          id: "candidate-" + c.id,
          point: {
            pixelSize: c.better_sunlight || c.reference_plane_better ? 10 : 7,
            color,
            outlineColor: C.Color.WHITE,
            outlineWidth: 1,
          },
          label: {
            text: `${c.search_resolution?.startsWith("refined candidate") ? "Moon-wide · " : "Nearby · "}${c.id}: ${c.delta_energy_wh !== null ? (c.delta_energy_wh >= 0 ? "+" : "") + c.delta_energy_wh.toFixed(0) + " Wh" : c.reference_delta_energy_wh == null ? "unknown" : "~" + c.reference_delta_energy_wh.toFixed(0) + " Wh reference"} | ${c.landing.status}`,
            font: "11px sans-serif",
            fillColor: color,
            pixelOffset: new C.Cartesian2(10, -10),
            showBackground: true,
            backgroundColor: C.Color.fromCssColorString("#14233bdd"),
          },
        });
      }
    }
    if (study.grid) {
      for (let lon = -180; lon < 180; lon += 30)
        overlays.add({
          polyline: {
            positions: Array.from({ length: 91 }, (_, i) =>
              cart(lon, -90 + i * 2, 300),
            ),
            width: 0.7,
            clampToGround: true,
            depthFailMaterial: C.Color.fromCssColorString("#b3cbef").withAlpha(0.22),
            material: C.Color.fromCssColorString("#b3cbef").withAlpha(0.22),
          },
        });
      for (let lat = -60; lat <= 60; lat += 30)
        overlays.add({
          polyline: {
            positions: Array.from({ length: 181 }, (_, i) =>
              cart(-180 + i * 2, lat, 300),
            ),
            width: 0.7,
            clampToGround: true,
            depthFailMaterial: C.Color.fromCssColorString("#b3cbef").withAlpha(0.22),
            material: C.Color.fromCssColorString("#b3cbef").withAlpha(0.22),
          },
        });
    }
    v.scene.requestRender();
    return () => overlays.destroy();
  }, [study.active, study.site, study.compareSite, study.annotations, study.grid,
    study.showRecommendations, study.siteSearch, terrainQuality, imageMode, terrainError, preferences.terrainExaggeration]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const overlays = terrainOverlays(v);
    const shownRoute = study.annotations.find(item => item.id === selectedAnnotation && item.route)
      ?? study.annotations.find(item => item.route?.order[0] === 0)
      ?? study.annotations.find(item => item.route);
    for (const a of study.annotations) {
      const color = C.Color.fromCssColorString(a.color);
      const positions = a.coordinates.map((c) => cart(...c, 50));
      if (a.kind === "point")
        overlays.mark(a.coordinates[0], {
          id: a.id,
          point: {
            pixelSize: 8,
            color,
            outlineColor: C.Color.WHITE,
            outlineWidth: 1,
          },
          label: {
            text: a.name,
            font: "12px sans-serif",
            pixelOffset: new C.Cartesian2(9, -9),
            horizontalOrigin: C.HorizontalOrigin.LEFT,
            fillColor: color,
            showBackground: true,
            backgroundColor: C.Color.fromCssColorString("#14233bdc"),
          },
        });
      else if (a.kind === "line" && a.route) {
        if (!clearsAvoidAreas(a.coordinates,[...(a.route.avoid ?? []),...(study.prohibitedAreas ?? [])])) continue;
        const savedRoute = a.route;
        savedRoute.legs.forEach((leg, i) => {
          overlays.line(
            a.coordinates.slice(i ? savedRoute.legEnds[i - 1] : 0, savedRoute.legEnds[i] + 1), 3,
            leg.end === 0 ? new C.PolylineDashMaterialProperty({ color: C.Color.GOLD }) : color, `${a.id}-leg-${i}`,
          );
        });
        if (a === shownRoute && !routeOverlay?.legs.length) {
          const stops = savedRoute.order.filter(stop => stop !== 0);
          stops.forEach((stop, i) => {
            const point = savedRoute.stops[stop - 1];
            if (study.annotations.some(item => item.kind === "point" && item.coordinates[0][0] === point[0] && item.coordinates[0][1] === point[1])) return;
            overlays.mark(point, {
              point: { pixelSize: 8, color, outlineColor: C.Color.BLACK, outlineWidth: 1 },
              label: {
                text: `${i + 1} · ${savedRoute.stopDetails?.[stop - 1]?.name || "Stop"}`,
                font: "12px sans-serif", fillColor: color, pixelOffset: new C.Cartesian2(9, -9),
                horizontalOrigin: C.HorizontalOrigin.LEFT, showBackground: true,
              },
            });
          });
        }
      } else if (a.kind === "line") {
        overlays.line(a.coordinates, 3, color, a.id);
      } else {
        overlays.add({
          id: a.id,
          polygon: {
            hierarchy: new C.PolygonHierarchy(positions),
            material: color.withAlpha(0.25),
            classificationType: C.ClassificationType.TERRAIN,
          },
        });
        overlays.line([...a.coordinates, a.coordinates[0]], 2, color);
      }
    }
    v.scene.requestRender();
    return () => overlays.destroy();
  }, [study.annotations, study.prohibitedAreas, selectedAnnotation, routeOverlay?.legs.length,
    terrainQuality, imageMode, terrainError, preferences.terrainExaggeration]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const overlays = terrainOverlays(v);
    const sitePoint: [number, number] = [mapSite.lon, mapSite.lat];
    if (study.directions) {
      for (const body of ["sun", "earth"] as const) {
        const name = body === "sun" ? "Sun" : "Earth";
        const color = C.Color.fromCssColorString(body === "sun" ? "#efc36d" : "#8accff");
        const positions = () => {
          const data = geometryRow.current?.[body];
          if (!data) return [];
          const origin = aboveTerrain(v.scene, sitePoint, 800);
          const direction = C.Cartesian3.normalize(C.Cartesian3.fromArray(data.vector), new C.Cartesian3());
          const end = C.Cartesian3.add(origin, C.Cartesian3.multiplyByScalar(direction, 450000, direction), new C.Cartesian3());
          return [origin, end];
        };
        overlays.add({
          position: new C.CallbackPositionProperty((_time, output) => {
            const end = positions()[1];
            return end && C.Cartesian3.clone(end, output);
          }, false),
          polyline: {
            positions: new C.CallbackProperty(positions, false),
            width: 2, arcType: C.ArcType.NONE,
            material: new C.PolylineArrowMaterialProperty(color),
          },
          label: {
            text: new C.CallbackProperty(() => `${name} ${geometryRow.current?.[body].elevation.toFixed(2) ?? ""}°`, false),
            font: "12px sans-serif", fillColor: color,
          },
        });
      }
    }
    for (const sat of study.satellites.filter(item => item.visible)) {
      const orbit = result?.orbits[sat.id];
      const color = C.Color.fromCssColorString(sat.color);
      const satellitePosition = new C.CallbackPositionProperty((_time, output) => {
        const position = geometryRow.current?.satellites[sat.id]?.position;
        if (!position) return undefined;
        return C.Cartesian3.multiplyByScalar(C.Cartesian3.fromArray(position, 0, output), 1000, output ?? new C.Cartesian3());
      }, false);
      const attitude = new C.HeadingPitchRoll(C.Math.toRadians(sat.phase), .08, 0);
      const orientation = new C.CallbackProperty((time, output) => {
        const point = satellitePosition.getValue(time);
        return point && C.Transforms.headingPitchRollQuaternion(point, attitude, ellipsoid, undefined, output);
      }, false);
      overlays.add({
        id: sat.id,
        position: satellitePosition,
        point: { pixelSize: 9, color, outlineColor: C.Color.WHITE, outlineWidth: 1 },
        label: { text: sat.name, font: "12px sans-serif", pixelOffset: new C.Cartesian2(10, -12), fillColor: color },
      });
      if (enhanced3d) {
        overlays.add({
          id: `${sat.id}-spacecraft-model`, position: satellitePosition, orientation,
          box: { dimensions: new C.Cartesian3(1800, 1250, 900), material: color, outline: true, outlineColor: C.Color.WHITE },
        });
        for (const side of [-1, 1]) {
          overlays.add({
            id: `${sat.id}-solar-panel-${side}`,
            position: new C.CallbackPositionProperty((time, output) => {
              const center = satellitePosition.getValue(time);
              const rotation = orientation.getValue(time);
              if (!center || !rotation) return undefined;
              const offset = C.Matrix3.multiplyByVector(
                C.Matrix3.fromQuaternion(rotation), new C.Cartesian3(side * 2000, 0, 0), new C.Cartesian3(),
              );
              return C.Cartesian3.add(center, offset, output ?? new C.Cartesian3());
            }, false),
            orientation,
            box: {
              dimensions: new C.Cartesian3(2200, 90, 1250), material: C.Color.fromCssColorString("#3f75a6"),
              outline: true, outlineColor: C.Color.fromCssColorString("#b9dcff"),
            },
          });
        }
      }
      if (orbit) overlays.add({
        polyline: {
          positions: orbit.positions.map(point => C.Cartesian3.multiplyByScalar(C.Cartesian3.fromArray(point), 1000, new C.Cartesian3())),
          width: 1.5, arcType: C.ArcType.NONE, material: color.withAlpha(.55),
        },
      });
      overlays.add({
        polyline: {
          positions: new C.CallbackProperty(time => {
            const point = satellitePosition.getValue(time);
            return point && geometryRow.current?.satellites[sat.id]?.above_reference ? [aboveTerrain(v.scene, sitePoint, 28), point] : [];
          }, false),
          width: 1, arcType: C.ArcType.NONE,
          material: new C.PolylineDashMaterialProperty({ color: color.withAlpha(.6) }),
        },
      });
    }
    v.scene.requestRender();
    return () => overlays.destroy();
  }, [mapSite, study.directions, study.satellites, result, enhanced3d]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || routeOverlay?.studyId !== study.id) return;
    const overlays = terrainOverlays(v);
    const mark = (point: [number, number], text: string, color: C.Color) => {
      overlays.mark(point, {
        point: { pixelSize: 9, color, outlineColor: C.Color.BLACK, outlineWidth: 2 },
        label: { text, font: "12px sans-serif", showBackground: true, pixelOffset: new C.Cartesian2(0, -18) },
      });
    };
    mark(routeOverlay.lander, "Lander site", C.Color.GOLD);
    routeOverlay.stops.forEach((point, i) => {
      const visit = routeOverlay.legs.findIndex(leg => leg.end === i + 1);
      mark(point, String(visit < 0 ? i + 1 : visit + 1), C.Color.SKYBLUE);
    });
    if (routeOverlay.origin) mark(routeOverlay.origin, "Return start", C.Color.ORANGE);
    for (const polygon of routeOverlay.avoid) {
      overlays.add({ polygon: {
        hierarchy: new C.PolygonHierarchy(polygon.map(point => cart(...point))),
        material: C.Color.RED.withAlpha(0.22),
        classificationType: C.ClassificationType.TERRAIN,
      }});
      overlays.line([...polygon, polygon[0]], 2, C.Color.SALMON.withAlpha(.8));
    }
    const line = (points: [number, number][], material: C.MaterialProperty | C.Color) => overlays.line(points, 4, material);
    line(routeOverlay.draft, C.Color.SALMON);
    const estimate = routeOverlay.track?.at(-1);
    if (estimate) {
      line(routeOverlay.track!, C.Color.AQUAMARINE);
      mark(estimate, "Sensor estimate", C.Color.AQUAMARINE);
    }
    for (const leg of routeOverlay.legs) {
      line(leg.path, leg.end === 0 || leg.spacing_m === null
        ? new C.PolylineDashMaterialProperty({ color: leg.end === 0 ? C.Color.GOLD : C.Color.LIGHTGRAY })
        : C.Color.DEEPSKYBLUE);
    }
    v.scene.requestRender();
    return () => overlays.destroy();
  }, [routeOverlay, study.id, terrainQuality, imageMode, terrainError, preferences.terrainExaggeration]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const overlays = terrainOverlays(v);
    const roverColor = C.Color.fromCssColorString("#50e6cc");
    const flightColor = C.Color.GOLD;
    const site = mapSite;
    const flight = () => {
      const progress = landingProgressRef.current;
      if (progress === null) return mission.current.flight;
      return {
        point: [site.lon, site.lat] as [number, number],
        altitude: 12000 * (1 - progress), stage: progress < 1 ? "Descent" : "Landed",
      };
    };
    const roverPosition = new C.CallbackPositionProperty((_time, output) => {
      const rover = mission.current.rover;
      return rover && aboveTerrain(v.scene, rover.point, 38, output);
    }, false);
    const flightPosition = new C.CallbackPositionProperty((_time, output) => {
      const pose = flight();
      return pose && aboveTerrain(v.scene, pose.point, pose.altitude + 82, output);
    }, false);
    const visibleMarker = (position: C.PositionProperty) => {
      return new C.CallbackProperty(time => {
        const point = position.getValue(time);
        return Boolean(point && visibleSurfaceMarker(v.scene, point));
      }, false);
    };
    function playbackLabel(text: () => string, color: C.Color, position: C.PositionProperty, left = false): C.LabelGraphics.ConstructorOptions {
      return {
        text: new C.CallbackProperty(text, false), show: visibleMarker(position),
        font: "bold 13px sans-serif", fillColor: color, showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#102339f0"),
        pixelOffset: new C.Cartesian2(left ? -13 : 14, left ? 2 : -22),
        horizontalOrigin: left ? C.HorizontalOrigin.RIGHT : C.HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      };
    }
    overlays.add({
      id: "mission-playback-rover", position: roverPosition,
      point: {
        show: visibleMarker(roverPosition), pixelSize: 12, color: roverColor,
        outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: playbackLabel(() => {
        const rover = mission.current.rover;
        return rover?.mobility === "walking" ? "Crew" : "Rover";
      }, roverColor, roverPosition, true),
    });
    overlays.add({
      id: "mission-playback-lander", position: flightPosition,
      orientation: C.Transforms.headingPitchRollQuaternion(cart(site.lon, site.lat), new C.HeadingPitchRoll(), ellipsoid),
      box: enhanced3d && effectiveView === "3d" ? {
        dimensions: new C.Cartesian3(170, 170, 130), material: C.Color.fromCssColorString("#87c8da"),
        outline: true, outlineColor: C.Color.WHITE,
      } : undefined,
      point: {
        show: visibleMarker(flightPosition), pixelSize: 9, color: flightColor, outlineColor: C.Color.BLACK,
        outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: playbackLabel(() => {
        const pose = flight();
        return pose ? `${study.analysis?.vehicle === "hopper" ? "Hopper" : "Lander"} · ${pose.stage}${pose.altitude > 0 ? ` · ${(pose.altitude / 1000).toFixed(1)} km` : ""}` : "";
      }, flightColor, flightPosition),
    });
    if (effectiveView === "3d") overlays.add({
      polyline: {
        positions: new C.CallbackProperty(time => {
          const pose = flight();
          const vehicle = flightPosition.getValue(time);
          return pose && vehicle && pose.altitude > 0 ? [aboveTerrain(v.scene, pose.point, 28), vehicle] : [];
        }, false),
        width: 2, arcType: C.ArcType.NONE,
        material: new C.PolylineDashMaterialProperty({ color: flightColor.withAlpha(.8) }),
      },
    });
    v.scene.requestRender();
    return () => overlays.destroy();
  }, [mapSite, study.analysis?.vehicle, enhanced3d, effectiveView]);

  // Keep coordinate edits visually tied to their actual location without resetting user pans every frame.
  useEffect(() => {
    const s = activeSite(study);
    const key = `${study.id}:${study.active}:${s.lat}:${s.lon}`;
    if (lastSite.current === key) return;
    lastSite.current = key;
    const v = viewer.current;
    if (v)
      v.camera.flyTo({
        destination: cart(s.lon, s.lat, 1000000),
        duration:
          document.documentElement.style.getPropertyValue(
            "--camera-animation",
          ) === "0"
            ? 0
            : 0.7,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
  }, [
    study.id,
    study.active,
    study.site.lat,
    study.site.lon,
    study.compareSite.lat,
    study.compareSite.lon,
  ]);
  const startLandingRun = (record: boolean, focused = false) => {
    const map = viewer.current;
    if (!map || map.isDestroyed()) return;
    if (!enhanced3d) {
      onStatus("3D descent preview is paused by the hardware performance setting.");
      return;
    }
    if (effectiveView !== "3d") {
      if (imageMode) {
        onStatus("Switch terrain rendering from Image map to Auto or 3D before starting a descent preview.");
        return;
      }
      onChange({ view: "3d" });
      window.setTimeout(() => landingRunner.current(record), 260);
      return;
    }
    if (landingFrame.current !== null || landingPreparing.current) {
      onStatus("A descent preview is already running. Reset it before starting another.");
      return;
    }
    if (!focused) {
      landingPreparing.current = true;
      const site = activeSite(study);
      onStatus("Focusing the map on the active landing point…");
      map.camera.flyTo({
        destination: aboveTerrain(map.scene, [site.lon, site.lat], 25000),
        duration: preferences.animations ? 0.7 : 0,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        complete: () => {
          landingPreparing.current = false;
          landingRunner.current(record, true);
        },
        cancel: () => { landingPreparing.current = false; },
      });
      return;
    }
    if (landingFrame.current !== null) cancelAnimationFrame(landingFrame.current);
    if (record) {
      const canvas = map.canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
      if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
        onStatus("This browser cannot record the 3D map. Try a current desktop browser with WebM support.");
        return;
      }
      let stream: MediaStream | null = null;
      try {
        stream = canvas.captureStream(30);
        const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
        const activeRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recorderChunks.current = [];
        activeRecorder.ondataavailable = (event) => { if (event.data.size) recorderChunks.current.push(event.data); };
        activeRecorder.onstop = () => {
          stream?.getTracks().forEach((track) => track.stop());
          if (!recorderChunks.current.length) return;
          const file = new Blob(recorderChunks.current, { type: activeRecorder.mimeType || "video/webm" });
          const url = URL.createObjectURL(file);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${study.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${study.active.toLowerCase()}-descent.webm`;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 3000);
          onStatus("Illustrative descent recording saved as WebM.");
        };
        activeRecorder.start();
        recorder.current = activeRecorder;
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        onStatus("Could not start the 3D recording. Try another desktop browser or disable hardware acceleration.");
        return;
      }
    }
    const started = performance.now();
    landingProgressRef.current = 0;
    window.dispatchEvent(new CustomEvent("luna-landing-progress", { detail: { progress: 0 } }));
    onStatus(record ? "Recording illustrative 3D descent…" : "Illustrative 3D descent preview started.");
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 10000);
      landingProgressRef.current = progress;
      if (Math.floor(progress * 100) % 3 === 0 || progress === 1) {
        window.dispatchEvent(new CustomEvent("luna-landing-progress", { detail: { progress } }));
      }
      map.scene.requestRender();
      if (progress < 1) landingFrame.current = requestAnimationFrame(tick);
      else {
        landingFrame.current = null;
        if (recorder.current?.state === "recording") recorder.current.stop();
        onStatus("Illustrative 3D descent complete. This is not a vehicle trajectory or landing clearance.");
      }
    };
    landingFrame.current = requestAnimationFrame(tick);
  };
  landingRunner.current = startLandingRun;
  const resetLandingRun = () => {
    if (landingFrame.current !== null) cancelAnimationFrame(landingFrame.current);
    landingFrame.current = null;
    landingPreparing.current = false;
    landingProgressRef.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    window.dispatchEvent(new CustomEvent("luna-landing-progress", { detail: { progress: null } }));
    viewer.current?.scene.requestRender();
  };
  landingReset.current = resetLandingRun;
  useEffect(() => () => {
    if (landingFrame.current !== null) cancelAnimationFrame(landingFrame.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);
  return (
    <div ref={mapSurface} className={`map-view map-tool-${tool}`} data-tour="map">
      {createPortal(<div ref={container} className="cesium-container live-map-renderer" />, document.getElementById("live-map-layer") || document.body)}
      <div ref={inputSurface} className="map-input-surface" tabIndex={0} aria-label="Lunar map. Use WASD to move in Moon walk mode; Shift increases speed. Press Escape to leave." />
      {terrainError && <div className="terrain-status" role="status">{terrainError}</div>}
      {mapError && (
        <div className="map-error" role="status">
          <span>Map renderer needs recovery: {mapError}</span>
          <button type="button" onClick={() => {
            const rect = container.current?.getBoundingClientRect();
            const active = viewer.current;
            if (!active || active.isDestroyed() || !rect || rect.width < 1 || rect.height < 1) {
              setMapError("The map is hidden or still has no display size. Switch to the map view, then retry.");
              return;
            }
            try { rendererFaulted.current = false; active.resize(); active.useDefaultRenderLoop = true; active.scene.requestRender(); setMapError(""); }
            catch (error) { setMapError(error instanceof Error ? error.message : "Map renderer could not recover"); }
          }}>Retry map</button>
        </div>
      )}
      <div className="map-caption">
        <strong>
          {effectiveView === "3d"
            ? "LUNAR GLOBE"
            : effectiveView === "2d"
              ? "GLOBAL EQUIRECTANGULAR"
              : "OBLIQUE MAP"}
        </strong>
        <span>{moonLayers[study.layer].id.replaceAll("_", " ")}</span>
      </div>
      <div
        ref={tools}
        className="map-tools"
        data-tour="map-tools"
        style={{ left: toolPosition.x, top: toolPosition.y, right: "auto", maxHeight: `calc(100% - ${toolPosition.y + 50}px)` }}
      >
        <button
          className="tool-drag-grip"
          title="Drag map tools"
          aria-label="Drag map tools"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.dataset.x = String(e.clientX - toolPosition.x);
            e.currentTarget.dataset.y = String(e.clientY - toolPosition.y);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const area =
              e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
            setToolPosition({
              x: Math.max(
                0,
                Math.min(
                  (area?.width || 800) - (tools.current?.offsetWidth || 48) - 8,
                  e.clientX - Number(e.currentTarget.dataset.x),
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  (area?.height || 700) - 96,
                  e.clientY - Number(e.currentTarget.dataset.y),
                ),
              ),
            });
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        >
          ⠿
        </button>
        {(
          [
            {
              id: "pan",
              icon: Hand,
              title:
                "Navigate: drag to rotate; wheel to zoom; right-drag to tilt",
            },
            {
              id: "site",
              icon: Crosshair,
              title: "Set study point: click the Moon",
            },
            { id: "point", icon: MapPin, title: "Add map note" },
            { id: "line", icon: Path, title: "Draw surface traverse" },
            { id: "polygon", icon: Polygon, title: "Draw study region" },
            {
              id: "measure",
              icon: Ruler,
              title: "Measure lunar surface distance",
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : ""}
            aria-label={t.title}
            title={t.title}
            onClick={() => {
              drawing.current = [];
              setPoints(0);
              setMeasureDistance(0);
              draftOverlay.current?.destroy();
              draftOverlay.current = null;
              setTool(t.id);
            }}
          >
            <t.icon size={18} />
          </button>
        ))}
        <hr />
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => {
            viewer.current?.camera.zoomIn(
              (viewer.current?.camera.positionCartographic.height || 1e6) * 0.4,
            );
            viewer.current?.scene.requestRender();
          }}
        >
          <Plus size={18} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => {
            viewer.current?.camera.zoomOut(
              (viewer.current?.camera.positionCartographic.height || 1e6) * 0.6,
            );
            viewer.current?.scene.requestRender();
          }}
        >
          <Minus size={18} />
        </button>
        <button
          title="Focus study point"
          aria-label="Focus study point"
          onClick={() => actions.current?.site()}
        >
          <NavigationArrow size={18} />
        </button>
        <button
          title="Fit whole Moon"
          aria-label="Fit whole Moon"
          onClick={() => actions.current?.home()}
        >
          <Globe size={18} />
        </button>
        <button
          title="Toggle solar lighting"
          aria-label="Toggle solar lighting"
          className={study.lighting ? "active" : ""}
          onClick={() => onChange({ lighting: !study.lighting })}
        >
          <Sun size={18} />
        </button>
      </div>
      <div className="map-view-buttons animated-segmented">
        {(["3d", "2d", "oblique"] as const).map((mode) => (
          <button
            className={`map-mode-button ${effectiveView === mode ? "active" : ""}`}
            disabled={imageMode && mode !== "2d"}
            title={imageMode && mode !== "2d" ? "Choose Auto or 3D terrain in Preferences to enable this view" : undefined}
            key={mode}
            onClick={() => onChange({ view: mode })}
          >
            {effectiveView === mode && preferences.animations && <motion.span className="segment-indicator" layoutId="map-view-indicator" transition={{ type: "spring", duration: 0.28, bounce: 0.1 }} />}
            <span>{mode.toUpperCase()}</span>
          </button>
        ))}
        <button
          className="map-direction-button"
          onClick={() => {
            onChange({ view: "3d" });
            setTimeout(() => actions.current?.north(), 150);
          }}
        >
          North
        </button>
        <button
          className="map-direction-button"
          onClick={() => {
            onChange({ view: "3d" });
            setTimeout(() => actions.current?.south(), 150);
          }}
        >
          South
        </button>
      </div>
      {effectiveView === "3d" && <button
        className={`map-compass-angle ${compassAngle ? "active" : ""}`}
        title="Toggle north-facing oblique camera"
        aria-label="Toggle north-facing oblique camera"
        onClick={() => actions.current?.toggleCompassAngle()}
      ><Compass size={18} /></button>}
      {walkMode && <div className="moon-walk-badge" role="status">MOON WALK · WASD move · Shift faster · Esc exit</div>}
      {["line", "polygon", "measure"].includes(tool) && (
        <div className="drawing-hint">
          {tool === "measure"
            ? `${measureDistance.toFixed(3)} km measured · ${points} points`
            : tool === "polygon"
              ? `Click map to outline study region · ${points} points`
              : `Click map to draw surface traverse · ${points} points`}
          <button onClick={finish}>Finish</button>
          <button
            onClick={() => {
              drawing.current = [];
              setPoints(0);
              setMeasureDistance(0);
              draftOverlay.current?.destroy();
              draftOverlay.current = null;
              viewer.current?.scene.requestRender();
              setTool("pan");
            }}
            aria-label="Cancel drawing"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {tool === "point" && (
        <div className="drawing-hint">
          Click the Moon to add a note. Edit it in the annotations panel.
        </div>
      )}
      {tool === "site" && (
        <div className="drawing-hint">
          Click the Moon to relocate scenario {study.active}.
        </div>
      )}
      <div className="map-info" style={imageryFailed ? { zIndex: 10 } : undefined}>
        <span className={tiles.startsWith("Loading") ? "is-loading" : ""}>{tiles}</span>
        {imageryFailed && <button type="button" style={{ pointerEvents: "auto" }} onClick={() => setImageryAttempt((attempt) => attempt + 1)}>Retry imagery</button>}
        <span>
          {activeSite(study).lat.toFixed(5)}°,{" "}
          {activeSite(study).lon.toFixed(5)}° E ·{" "}
          {cursorTime(study).replace("T", " ").slice(0, 19)} UTC
        </span>
      </div>
      <div className="map-model-note">
        {imageMode ? "Image map · terrain geometry off" : hosted ? "Reference sphere · no terrain relief" : terrainError ? "Terrain unavailable · reference sphere" : `LOLA 3D terrain · ${terrainQuality} detail · ${preferences.terrainExaggeration.toFixed(1)}× elevation`} ·{" "}
        {study.lighting ? "SPICE solar lighting" : "Unlit surface mosaic"} · {enhanced3d ? "3D spacecraft models active" : preferences.hardware3d ? "3D hardware paused by performance guard" : "3D hardware off in Preferences"}
      </div>
    </div>
  );
}
