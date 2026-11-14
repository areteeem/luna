import unittest
from time import monotonic
from unittest.mock import patch

import numpy as np

from surface_routes import Terrain, find_path, intersects, plan_route, route_leg


class SurfaceRouteTests(unittest.TestCase):
    def search(self, heights, start=(5, 15), end=(24, 15), polygons=(), uphill=5):
        return find_path(Terrain(heights, 1., (0, 0), polygons), start, end, 12, uphill, monotonic() + 5)

    def test_flat_route(self):
        status, (path, metrics, _) = self.search(np.zeros((32, 32)))
        self.assertEqual(status, "ok")
        self.assertEqual(path, [(5, 15), (24, 15)])
        self.assertAlmostEqual(metrics.distance, 19)
        self.assertEqual(metrics.gain, 0)

    def test_avoid_polygon_during_search_and_smoothing(self):
        box = ((12, 11), (17, 11), (17, 19), (12, 19))
        status, (path, metrics, _) = self.search(np.zeros((32, 32)), polygons=(box,))
        self.assertEqual(status, "ok")
        self.assertGreater(metrics.distance, 19)
        for a, b in zip(path, path[1:]):
            self.assertFalse(any(intersects(a, b, c, d) for c, d in zip(box, (*box[1:], box[0]))))

    def test_crater_cross_slope_and_missing_cells(self):
        heights = np.zeros((32, 32))
        heights[10:21, 12:18] = -9
        heights[13:17, 14:16] = np.nan
        status, (path, metrics, _) = self.search(heights)
        self.assertEqual(status, "ok")
        self.assertGreater(len(path), 2)
        self.assertAlmostEqual(metrics.gain, 0)
        yy, _ = np.mgrid[:32, :32]
        self.assertEqual(self.search(yy * .3)[0], "blocked-point")

    def test_walk_avoids_climbing_a_gradual_bump(self):
        yy, xx = np.mgrid[:32, :32]
        heights = np.maximum(0, 0.19 * (7 - np.hypot(xx - 15, yy - 15)))
        status, (_, metrics, _) = self.search(heights, uphill=15)
        self.assertEqual(status, "ok")
        self.assertGreater(metrics.distance, 19)
        self.assertLess(metrics.gain, 1.33)

    def test_direction_changes_ascent_and_cost(self):
        _, xx = np.mgrid[:32, :32]
        status, (_, uphill, cost_up) = self.search(xx * .1)
        reverse, (_, downhill, cost_down) = self.search(xx * .1, start=(24, 15), end=(5, 15))
        self.assertEqual((status, reverse), ("ok", "ok"))
        self.assertGreater(uphill.gain, downhill.gain)
        self.assertGreater(cost_up, cost_down)

    def test_stop_optimizer_counts_return(self):
        values = {(0, 1): 1, (1, 2): 1, (2, 0): 90, (0, 2): 3, (2, 1): 3, (1, 0): 3}

        def solve(a, b, *_):
            return "ok", {"cost": values[int(a[0]), int(b[0])]}

        payload = {"lander": [0, 0], "stops": [[1, 0], [2, 0]]}
        self.assertEqual(plan_route(payload, solve)["order"], (0, 2, 1, 0))
        self.assertEqual(plan_route(dict(payload, keep_order=True), solve)["order"], (0, 1, 2, 0))

    def test_global_terrain_covers_nonpolar_route(self):
        with patch("surface_routes.raster", return_value=None), patch(
            "surface_routes.global_grid"
        ), patch("surface_routes.global_heights", side_effect=lambda lon, lat: np.zeros(lon.shape)):
            result = plan_route({"lander": [23.47, 0.67], "stops": [[23.50, 0.68]]})
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["legs"]), 2)
        for leg in result["legs"]:
            self.assertEqual(leg["source"], "LOLA Global LDEM_16")
            self.assertGreater(leg["spacing_m"], 1800)

    def test_polar_wrap_and_missing_coverage(self):
        with patch("surface_routes.raster", return_value=None), patch(
            "surface_routes.global_grid", side_effect=ValueError
        ):
            self.assertEqual(route_leg((179.99, -89.7), (-179.99, -89.7), (), 12, 5,
                                      monotonic() + 3)[0], "missing-coverage")
        with patch("surface_routes.raster", return_value=(None, None, None, 80.)), patch(
            "surface_routes.interpolate_grid", side_effect=lambda _, x, y: np.zeros(x.shape)
        ):
            status, result = route_leg((179.99, -89.7), (-179.99, -89.7), (), 12, 5, monotonic() + 3)
        self.assertEqual(status, "ok")
        self.assertLess(result["distance_m"], 5)


if __name__ == "__main__":
    unittest.main()
