import { surfaceDistance } from "./study";
import type { LunarPoint } from "./surfaceRoutes";

type XY = [number, number];
const rad = Math.PI / 180;
const radius = 1737400;
const side = (a: XY, b: XY, p: XY) => (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
const edges = (polygon: XY[]) => polygon.map((a,i) => [a,polygon[(i+1)%polygon.length]] as const);

function intersects(a: XY,b: XY,c: XY,d: XY) {
  const overlap = ([0,1] as const).every(i =>
    Math.max(Math.min(a[i],b[i]),Math.min(c[i],d[i])) <= Math.min(Math.max(a[i],b[i]),Math.max(c[i],d[i])));
  return overlap && side(a,b,c)*side(a,b,d) <= 0 && side(c,d,a)*side(c,d,b) <= 0;
}

function inside(p: XY, polygon: XY[]) {
  return edges(polygon).reduce((hit,[a,b]) =>
    (a[1]>p[1]) !== (b[1]>p[1]) && p[0] < a[0]+(p[1]-a[1])*(b[0]-a[0])/(b[1]-a[1]) ? !hit : hit,false);
}

// A gnomonic projection maps the great-circle arcs rendered by Cesium to lines.
function projection(center: LunarPoint) {
  const lat = center[1]*rad;
  const sin = Math.sin(lat), cos = Math.cos(lat);
  return {
    forward([lon,latitude]: LunarPoint): XY {
      const phi = latitude*rad, lam = (lon-center[0])*rad;
      const z = sin*Math.sin(phi)+cos*Math.cos(phi)*Math.cos(lam);
      return z > 1e-6 ? [radius*Math.cos(phi)*Math.sin(lam)/z,
        radius*(cos*Math.sin(phi)-sin*Math.cos(phi)*Math.cos(lam))/z] : [NaN,NaN];
    },
    inverse([x,y]: XY): LunarPoint {
      const north = y/radius, east = x/radius;
      const horizontal = cos-north*sin;
      const lon = center[0]+Math.atan2(east,horizontal)/rad;
      return [((lon+540)%360)-180, Math.atan2(sin+north*cos,Math.hypot(east,horizontal))/rad];
    },
  };
}

function context(center: LunarPoint, avoid: LunarPoint[][]) {
  const {forward,inverse} = projection(center);
  const polygons = avoid.map(poly => poly.map(forward));
  if (polygons.some(poly => poly.some(p => !p.every(Number.isFinite)))) return null;
  const walls = polygons.flatMap(edges);
  const available = (p: XY) => p.every(Number.isFinite) && !polygons.some(poly => inside(p,poly))
    && !walls.some(([a,b]) => intersects(p,p,a,b));
  const visible = (a: XY,b: XY) => !walls.some(([c,d]) => intersects(a,b,c,d));
  return {forward,inverse,polygons,available,visible};
}

export function clearsAvoidAreas(path: LunarPoint[], avoid: LunarPoint[][]) {
  if (!avoid.length) return true;
  if (!path.length) return false;
  const area = context(path[0],avoid);
  if (!area) return false;
  const points = path.map(area.forward);
  return points.every(area.available) && points.slice(1).every((p,i) => area.visible(points[i],p));
}

/** Visibility graph around prohibited polygons for terrain unchecked routing. */
export function detourPaths(points: LunarPoint[], avoid: LunarPoint[][]) {
  const area = context(points[0],avoid);
  if (!area) return null;
  const terminals = points.map(area.forward);
  if (!terminals.every(area.available)) return null;
  const candidates: XY[] = [];
  for (const polygon of area.polygons) {
    for (const vertex of polygon) {
      const index = polygon.indexOf(vertex);
      const previous = polygon[(index+polygon.length-1)%polygon.length];
      const next = polygon[(index+1)%polygon.length];
      const angle = (p: XY) => Math.atan2(p[1]-vertex[1],p[0]-vertex[0]);
      const incoming = angle(previous), outgoing = angle(next);
      const mid = (incoming+outgoing)/2;
      for (const angle of [mid,mid+Math.PI,incoming+Math.PI/2,incoming-Math.PI/2,outgoing+Math.PI/2,outgoing-Math.PI/2]) {
        const candidate: XY = [vertex[0]+Math.cos(angle),vertex[1]+Math.sin(angle)];
        if (area.available(candidate)) candidates.push(candidate);
      }
    }
  }

  const nodes = [...terminals,...candidates];
  const globe = [...points,...candidates.map(area.inverse)];
  const graph: {to:number; length:number}[][] = nodes.map(() => []);
  for (let i=0;i<nodes.length;i++) for (let j=0;j<i;j++) {
    if (!area.visible(nodes[i],nodes[j])) continue;
    const length = surfaceDistance(globe[i],globe[j])*1000;
    graph[i].push({to:j,length});
    graph[j].push({to:i,length});
  }

  return points.map((_,start) => {
    const distance = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const done = new Set<number>();
    distance[start] = 0;
    while (done.size < nodes.length) {
      let current = -1;
      for (let i=0;i<nodes.length;i++) {
        if (!done.has(i) && distance[i] < (current < 0 ? Infinity : distance[current])) current = i;
      }
      if (current < 0) break;
      done.add(current);
      if (terminals.every((_,i) => done.has(i))) break;
      for (const {to,length} of graph[current]) {
        const cost = distance[current]+length;
        if (cost < distance[to]) { distance[to] = cost; previous[to] = current; }
      }
    }
    return points.map((_,end) => {
      const path: LunarPoint[] = [];
      for (let at=end;at>=0;at=previous[at]) path.unshift(globe[at]);
      return { path, distance: distance[end] };
    });
  });
}
