"""Bounded traverse planning on the installed LOLA DEMs."""
from dataclasses import dataclass
from functools import lru_cache
from heapq import heappop, heappush
from itertools import permutations
from math import acos, atan, ceil, degrees, hypot, isfinite, radians, tan
from time import monotonic

import numpy as np
from pyproj import CRS, Transformer

from terrain_model import CRS_LL, R, TO_SP, interpolate_grid, raster
from visual_terrain import global_grid, global_heights

GLOBAL_SOURCE = "LOLA Global LDEM_16"
GLOBAL_SPACING = round(R * radians(1 / 16))
SOURCES = (
    ("site04.tif", "LOLA Site 04"),
    ("lola80s.tif", "LOLA South Polar"),
    (None, GLOBAL_SOURCE),
)
DIRECTIONS = ((0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1))
MAX_GRID_CELLS = 160_000
MAX_EXPANSIONS = 180_000


def point(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("Expected a longitude and latitude pair.")
    lon, lat = map(float, value)
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("Coordinates are outside the lunar map.")
    return lon, lat


def number(value, low, high):
    result = float(value)
    if not isfinite(result) or not low <= result <= high:
        raise ValueError(f"Expected a number between {low} and {high}.")
    return result


def point_in_polygon(x, y, polygon):
    inside = False
    for (ax, ay), (bx, by) in zip(polygon, (*polygon[1:], polygon[0])):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def intersects(a, b, c, d):
    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    if any(max(a[i], b[i]) < min(c[i], d[i]) or max(c[i], d[i]) < min(a[i], b[i]) for i in (0, 1)):
        return False
    return side(a, b, c) * side(a, b, d) <= 0 and side(c, d, a) * side(c, d, b) <= 0


@dataclass
class Terrain:
    heights: np.ndarray
    step: float
    origin: tuple
    polygons: tuple = ()

    def __post_init__(self):
        north, east = np.gradient(self.heights, self.step)
        self.slopes = np.hypot(north, east)

    def xy(self, row, col):
        return self.origin[0] + col * self.step, self.origin[1] + row * self.step

    def cell(self, x, y):
        return round((y - self.origin[1]) / self.step), round((x - self.origin[0]) / self.step)


@dataclass(frozen=True)
class Travel:
    distance: float = 0.
    gain: float = 0.
    grade: float = 0.
    climb_effort: float = 0.

    def __add__(self, other):
        return Travel(self.distance + other.distance, self.gain + other.gain,
                      max(self.grade, other.grade), self.climb_effort + other.climb_effort)


def turn(a, b, c):
    u = b[0] - a[0], b[1] - a[1]
    v = c[0] - b[0], c[1] - b[1]
    norm = hypot(*u) * hypot(*v)
    return acos(max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / norm))) if norm else 0.


def find_path(terrain, start, end, slope_deg, uphill_weight, deadline):
    """Search heading states and screen the same segments used in directions."""
    heights, step = terrain.heights, terrain.step
    threshold = tan(radians(slope_deg))
    blocked = ~(np.isfinite(heights) & (terrain.slopes <= threshold))
    for polygon in terrain.polygons:
        low = terrain.cell(*np.min(polygon, axis=0))
        high = terrain.cell(*np.max(polygon, axis=0))
        for row in range(max(0, low[0]), min(heights.shape[0], high[0] + 1)):
            for col in range(max(0, low[1]), min(heights.shape[1], high[1] + 1)):
                if point_in_polygon(*terrain.xy(row, col), polygon):
                    blocked[row, col] = True

    def passable(cell):
        row, col = cell
        return 0 <= row < heights.shape[0] and 0 <= col < heights.shape[1] and not blocked[cell]

    def avoids(a, b):
        for polygon in terrain.polygons:
            if point_in_polygon(*a, polygon) or point_in_polygon(*b, polygon):
                return False
            if any(intersects(a, b, c, d) for c, d in zip(polygon, (*polygon[1:], polygon[0]))):
                return False
        return True

    def travel_for(distance, rise):
        grade = abs(rise) / distance if distance else 0.
        gain = max(0., rise)
        # Concentrated climbing costs more than the same gain on a gentler grade.
        return Travel(distance, gain, degrees(atan(grade)), gain * (1 + 2 * grade / threshold))

    @lru_cache(maxsize=180_000)
    def edge(a, b):
        if not passable(a) or not passable(b):
            return None
        if a[0] != b[0] and a[1] != b[1] and not (passable((a[0], b[1])) and passable((b[0], a[1]))):
            return None
        if terrain.polygons and not avoids(terrain.xy(*a), terrain.xy(*b)):
            return None
        rise = float(heights[b] - heights[a])
        distance = step * hypot(b[0] - a[0], b[1] - a[1])
        if abs(rise) > threshold * distance:
            return None
        return travel_for(distance, rise)

    def segment(a, b):
        if not passable(terrain.cell(*a)) or not passable(terrain.cell(*b)) or not avoids(a, b):
            return None
        distance = hypot(b[0] - a[0], b[1] - a[1])
        count = max(1, ceil(distance / (step / 3)))
        total = Travel()
        previous = terrain.cell(*a)
        previous_height = sample_height(a)
        if previous_height is None:
            return None
        for index in range(1, count + 1):
            fraction = index / count
            xy = (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)
            cell = terrain.cell(*xy)
            if cell != previous and edge(previous, cell) is None:
                return None
            height = sample_height(xy)
            if height is None:
                return None
            rise = height - previous_height
            span = distance / count
            if abs(rise) > threshold * span:
                return None
            total += travel_for(span, rise)
            previous, previous_height = cell, height
        return total

    def sample_height(xy):
        x, y = xy
        col = (x - terrain.origin[0]) / step
        row = (y - terrain.origin[1]) / step
        r, c = int(row // 1), int(col // 1)
        if not (0 <= r < heights.shape[0] - 1 and 0 <= c < heights.shape[1] - 1):
            return None
        samples = heights[r:r + 2, c:c + 2]
        if not np.isfinite(samples).all():
            return None
        ry, cx = row - r, col - c
        return float((1 - ry) * ((1 - cx) * samples[0, 0] + cx * samples[0, 1])
                     + ry * ((1 - cx) * samples[1, 0] + cx * samples[1, 1]))

    def cost(travel):
        return travel.distance + uphill_weight * travel.climb_effort

    begin, finish = terrain.cell(*start), terrain.cell(*end)
    if not (passable(begin) and passable(finish) and avoids(start, start) and avoids(end, end)):
        return "blocked-point", None
    entry, exit_leg = segment(start, terrain.xy(*begin)), segment(terrain.xy(*finish), end)
    if entry is None or exit_leg is None:
        return "blocked-point", None
    direct = segment(start, end)
    # A flat direct route meets the distance lower bound.
    if direct is not None and direct.gain < 1e-8:
        return "ok", ([start, end], direct, cost(direct))

    initial = (*begin, -1)
    queue = [(0., 0., initial)]
    previous_state = {}
    best = {initial: 0.}
    turn_weight = 2 * step
    expansions = 0
    while queue:
        _, g, state = heappop(queue)
        if g != best[state]:
            continue
        row, col, heading = state
        if (row, col) == finish:
            break
        expansions += 1
        if expansions >= MAX_EXPANSIONS or (expansions % 256 == 0 and monotonic() > deadline):
            return "search-limit", None
        for index, (dy, dx) in enumerate(DIRECTIONS):
            neighbor = row + dy, col + dx
            travel = edge((row, col), neighbor)
            if travel is None:
                continue
            bend = min((index - heading) % 8, (heading - index) % 8) if heading >= 0 else 0
            candidate = g + cost(travel) + turn_weight * bend * radians(45)
            next_state = (*neighbor, index)
            if candidate >= best.get(next_state, float("inf")):
                continue
            best[next_state] = candidate
            previous_state[next_state] = state
            estimate = hypot(neighbor[0] - finish[0], neighbor[1] - finish[1]) * step
            heappush(queue, (candidate + estimate, candidate, next_state))
    else:
        return "no-route", None

    cells = [state[:2]]
    while state != initial:
        state = previous_state[state]
        cells.append(state[:2])
    cells.reverse()
    points = [terrain.xy(*cell) for cell in cells]
    metrics = [edge(a, b) for a, b in zip(cells, cells[1:])]
    if start != points[0]:
        points.insert(0, start)
        metrics.insert(0, entry)
    if end != points[-1]:
        points.append(end)
        metrics.append(exit_leg)

    # Shortcut only within the travel cost budget and only over checked ground.
    prefix = [0.]
    for metric in metrics:
        prefix.append(prefix[-1] + cost(metric))
    simplified = [points[0]]
    summary = Travel()
    index = 0
    while index < len(points) - 1:
        if monotonic() > deadline:
            return "search-limit", None
        target = index + 1
        metric = metrics[index]
        for candidate in range(min(len(points) - 1, index + 64), target, -1):
            dx = points[candidate][0] - points[index][0]
            dy = points[candidate][1] - points[index][1]
            if hypot(dx, dy) > 1.05 * (prefix[candidate] - prefix[index]):
                continue
            shortcut = segment(points[index], points[candidate])
            if shortcut is not None and cost(shortcut) <= 1.05 * (prefix[candidate] - prefix[index]):
                target, metric = candidate, shortcut
                break
        simplified.append(points[target])
        summary += metric
        index = target

    def ranked(path, travel):
        return cost(travel) + turn_weight * sum(turn(a, b, c) for a, b, c in zip(path, path[1:], path[2:]))

    result = (simplified, summary, ranked(simplified, summary))
    if direct is not None and cost(direct) <= result[2] and cost(direct) <= 1.05 * prefix[-1]:
        result = ([start, end], direct, cost(direct))
    return "ok", result


def route_leg(start, end, polygons, grade, uphill, deadline):
    center_lon, center_lat = min(start, end)
    local = CRS.from_proj4(f"+proj=aeqd +lat_0={center_lat} +lon_0={center_lon} +R={R} +units=m +no_defs")
    forward = Transformer.from_crs(CRS_LL, local, always_xy=True)
    inverse = Transformer.from_crs(local, CRS_LL, always_xy=True)
    to_dem = Transformer.from_crs(local, TO_SP.target_crs, always_xy=True)
    a, b = forward.transform(*start), forward.transform(*end)
    distance = hypot(b[0] - a[0], b[1] - a[1])
    if distance < 0.01:
        return "duplicate-point", None
    if not isfinite(distance) or distance > 25_000:
        return "search-limit", None
    projected = [tuple(forward.transform(*p) for p in polygon) for polygon in polygons]
    if any(not np.isfinite(polygon).all() for polygon in projected):
        raise ValueError("Avoid areas must be local to the mission.")
    projected = tuple(projected)
    if any(point_in_polygon(*a, poly) or point_in_polygon(*b, poly) for poly in projected):
        return "blocked-point", None
    last = "missing-coverage"
    chosen_source = None
    for multiplier in (1, 2):
        if monotonic() > deadline:
            return "search-limit", None
        for filename, source in SOURCES:
            if chosen_source is not None and (filename, source) != chosen_source:
                continue
            if filename is None:
                try:
                    global_grid()
                except (OSError, ValueError):
                    continue
                step = GLOBAL_SPACING
            else:
                dem = raster(filename)
                if dem is None:
                    continue
                step = dem[3]
            margin = multiplier * max(3 * step, min(1000., distance * .25))
            x0, y0 = min(a[0], b[0]) - margin, min(a[1], b[1]) - margin
            cols = ceil((abs(b[0] - a[0]) + 2 * margin) / step) + 1
            rows = ceil((abs(b[1] - a[1]) + 2 * margin) / step) + 1
            if cols * rows > MAX_GRID_CELLS:
                continue
            xs, ys = np.meshgrid(x0 + step * np.arange(cols), y0 + step * np.arange(rows))
            if filename is None:
                lon, lat = inverse.transform(xs, ys)
                heights = global_heights(lon, lat)
            else:
                xx, yy = to_dem.transform(xs, ys)
                heights = interpolate_grid(dem, xx, yy)
            terrain = Terrain(heights, step, (x0, y0), projected)
            if not all(np.isfinite(heights[terrain.cell(*p)]) for p in (a, b)):
                continue
            # Prefer regional coverage over a high-resolution window cut by the DEM boundary.
            if chosen_source is None and filename == SOURCES[0][0] and not np.isfinite(heights).all():
                continue
            chosen_source = (filename, source)
            last, found = find_path(terrain, a, b, grade, uphill, deadline)
            if found is not None:
                positions, summary, cost = found
                path = [list(inverse.transform(*p)) for p in positions]
                path[0], path[-1] = start, end
                return "ok", dict(path=path, distance_m=summary.distance, ascent_m=summary.gain,
                                  grade_deg=summary.grade, source=source, spacing_m=step, cost=cost)
            # Once a DEM covers the leg, a coarser DEM must not mask its obstacles.
            if last in ("blocked-point", "search-limit"):
                return last, None
            break
    return last, None


def plan_route(payload, solve=route_leg):
    if not isinstance(payload, dict):
        raise ValueError("Expected a route request.")
    lander = point(payload.get("lander"))
    mode = payload.get("mobility", "rover")
    if mode not in ("rover", "walking"):
        raise ValueError("Select a wheeled rover or suited astronaut.")
    grade = number(payload.get("max_grade_deg", 10 if mode == "walking" else 12), 1, 35)
    is_return = payload.get("origin") is not None
    stops = [payload["origin"]] if is_return else payload.get("stops")
    if not isinstance(stops, list) or not 1 <= len(stops) <= 6:
        raise ValueError("Pick one to six mission stops.")
    points = [lander, *map(point, stops)]
    polygons = payload.get("avoid", [])
    if not isinstance(polygons, list) or len(polygons) > 8 or any(
        not isinstance(polygon, list) or not 3 <= len(polygon) <= 32 for polygon in polygons
    ):
        raise ValueError("Use up to eight avoid areas with 3–32 vertices each.")
    polygons = tuple(tuple(map(point, polygon)) for polygon in polygons)
    deadline = monotonic() + 20
    uphill = 9 if mode == "walking" else 5

    @lru_cache(maxsize=42)
    def leg(a, b):
        status, result = solve(points[a], points[b], polygons, grade, uphill, deadline)
        return status, dict(result, start=a, end=b) if result is not None else None

    if is_return:
        sequences = [(1, 0)]
    elif payload.get("keep_order"):
        sequences = [(*range(len(points)), 0)]
    else:
        sequences = ((0, *order, 0) for order in permutations(range(1, len(points))))
    best = None
    failures = set()
    for sequence in sequences:
        legs = []
        for a, b in zip(sequence, sequence[1:]):
            status, result = leg(a, b)
            if result is None:
                failures.add(status)
                break
            legs.append(result)
        else:
            cost = sum(item["cost"] for item in legs)
            if best is None or cost < best[0]:
                best = (cost, sequence, legs)

    if best is not None:
        return dict(status="ok", order=best[1], legs=best[2])
    status = next((item for item in ("search-limit", "duplicate-point", "blocked-point", "missing-coverage") if item in failures), "no-route")
    return dict(status=status, order=[], legs=[])
