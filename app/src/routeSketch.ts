import { detourPaths } from "./routeAvoidance";
import { surfaceDistance } from "./study";
import type { LunarPoint, RouteResult } from "./surfaceRoutes";

/** A distance-only sketch for when terrain screening cannot produce a path. */
export function sketchRoute(lander: LunarPoint, stops: LunarPoint[], origin: LunarPoint | undefined, keepOrder: boolean, avoid: LunarPoint[][] = []): RouteResult {
  const points = [lander, ...(origin ? [origin] : stops)];
  const detours = avoid.length ? detourPaths(points,avoid) : null;
  const blocked = { status: "avoid-blocked", order: [], legs: [] };
  if (avoid.length && !detours) return blocked;
  const distances = detours?.map(row => row.map(leg => leg.distance))
    ?? points.map(a => points.map(b => surfaceDistance(a,b)*1000));
  const stopIds = stops.map((_, index) => index + 1);
  let order = origin ? [1, 0] : [0, ...stopIds, 0];

  if (!origin && !keepOrder) {
    let shortest = Infinity;
    const visit = (path: number[], remaining: number[], distance: number) => {
      const last = path[path.length - 1];
      if (!remaining.length) {
        const total = distance + distances[last][0];
        if (total < shortest) {
          shortest = total;
          order = [...path, 0];
        }
        return;
      }
      for (const next of remaining) {
        visit([...path, next], remaining.filter((id) => id !== next), distance + distances[last][next]);
      }
    };
    visit([0], stopIds, 0);
  }
  if (order.slice(1).some((end,index) => !Number.isFinite(distances[order[index]][end]))) return blocked;
  return {
    status: "unchecked",
    order,
    legs: order.slice(1).map((end, index) => {
      const start = order[index];
      return { start, end, path: detours?.[start][end].path ?? [points[start], points[end]], distance_m: distances[start][end],
        ascent_m: null, grade_deg: null, source: "", spacing_m: null };
    }),
  };
}
