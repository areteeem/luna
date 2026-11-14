import * as C from "cesium";
import { interpolateSurface } from "./missionPlayback";
import { surfaceDistance } from "./study";
import type { LunarPoint } from "./surfaceRoutes";

export function renderedGroundHeight(scene: C.Scene, lon: number, lat: number) {
  // Globe.getHeight intersects the loaded terrain mesh with its current exaggeration.
  return scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat)) ?? 0;
}

export function aboveTerrain(scene: C.Scene, [lon, lat]: LunarPoint, clearance: number, result?: C.Cartesian3) {
  return C.Cartesian3.fromDegrees(lon, lat, renderedGroundHeight(scene, lon, lat) + clearance, scene.globe.ellipsoid, result);
}

export function visibleSurfaceMarker(scene: C.Scene, position: C.Cartesian3) {
  if (scene.mode !== C.SceneMode.SCENE3D) return true;
  const normal = scene.globe.ellipsoid.geodeticSurfaceNormal(position, new C.Cartesian3());
  return C.Cartesian3.dot(normal, C.Cartesian3.subtract(scene.camera.positionWC, position, new C.Cartesian3())) > -100;
}

function samplePath(path: LunarPoint[]) {
  const lengths = path.slice(1).map((point, i) => surfaceDistance(path[i], point));
  const stepKm = Math.max(.075, lengths.reduce((a, b) => a + b, 0) / 2048);
  const samples = [path[0]];
  for (let i = 0; i < lengths.length; i++) {
    const count = Math.max(1, Math.ceil(lengths[i] / stepKm));
    for (let j = 1; j <= count; j++) {
      samples.push(interpolateSurface(path[i], path[i + 1], j / count));
    }
  }
  return samples;
}

export function terrainOverlays(viewer: C.Viewer) {
  const entities: C.Entity[] = [];
  const refreshers: (() => void)[] = [];
  function add(options: C.Entity.ConstructorOptions) {
    const entity = viewer.entities.add(options);
    entities.push(entity);
    return entity;
  }
  function refresh() {
    refreshers.forEach(update => update());
    viewer.scene.requestRender();
  }
  const removeProgress = viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
    if (pending === 0) refresh();
  });
  const removeFirstFrame = viewer.scene.postRender.addEventListener(() => {
    removeFirstFrame();
    if (refreshers.length) refresh();
  });
  return {
    add,
    mark(point: LunarPoint, options: Omit<C.Entity.ConstructorOptions, "position">, lift = 18, labelVisible = () => true) {
      let position = aboveTerrain(viewer.scene, point, lift);
      const entity = add({
        ...options, position,
        point: options.point && { ...options.point, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: options.label && { ...options.label, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
      if (entity.point) entity.point.show = new C.CallbackProperty(() => visibleSurfaceMarker(viewer.scene, position), false);
      if (entity.label) entity.label.show = new C.CallbackProperty(() => labelVisible() && visibleSurfaceMarker(viewer.scene, position), false);
      refreshers.push(() => {
        position = aboveTerrain(viewer.scene, point, lift);
        entity.position = new C.ConstantPositionProperty(position);
      });
      return entity;
    },
    line(path: LunarPoint[], width: number, material: C.MaterialProperty | C.Color, id?: string) {
      if (path.length < 2) return;
      const points = samplePath(path);
      const positions = () => points.map(point => aboveTerrain(viewer.scene, point, 28));
      const entity = add({ id, polyline: { positions: positions(), width, material, arcType: C.ArcType.NONE } });
      refreshers.push(() => { entity.polyline!.positions = new C.ConstantProperty(positions()); });
    },
    destroy() {
      removeProgress();
      removeFirstFrame();
      if (viewer.isDestroyed()) return;
      entities.forEach(entity => viewer.entities.remove(entity));
      viewer.scene.requestRender();
    },
  };
}
