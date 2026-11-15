import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from prepare_data import parse_horizons


class HorizonsFixtureTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "data/sun-horizons.json").read_text())

    def test_real_fixture_count_time_and_angular_units(self):
        rows = parse_horizons(self.payload, "10")
        self.assertEqual(len(rows), 49)
        self.assertEqual(rows[0]["time_utc"], "2026-11-14T00:00:00Z")
        self.assertEqual(rows[-1]["time_utc"], "2026-11-15T23:53:00Z")
        self.assertAlmostEqual(rows[0]["angular_radius_deg"], 1942.008 / 7200)
        self.assertAlmostEqual(rows[0]["elevation_deg"], 1.258335)

    def test_api_error_on_successful_http_must_fail(self):
        self.payload["error"] = "Invalid coordinate"
        with self.assertRaises(ValueError):
            parse_horizons(self.payload, "10")

    def test_missing_table_must_fail(self):
        self.payload["result"] = self.payload["result"].replace("$$EOE", "")
        with self.assertRaises(ValueError):
            parse_horizons(self.payload, "10")

    def test_nonfinite_geometry_must_fail(self):
        self.payload["result"] = self.payload["result"].replace("126.627333", "nan", 1)
        with self.assertRaises(ValueError):
            parse_horizons(self.payload, "10")

    def test_wrong_frame_must_fail(self):
        self.payload["result"] = self.payload["result"].replace("MEAN_ME", "IAU_MOON")
        with self.assertRaises(ValueError):
            parse_horizons(self.payload, "10")

    def test_duplicate_timestamp_must_fail(self):
        self.payload["result"] = self.payload["result"].replace("2026-Nov-14 01:00:00", "2026-Nov-14 00:00:00")
        with self.assertRaises(ValueError):
            parse_horizons(self.payload, "10")

    def test_earth_has_independent_position_and_larger_disk(self):
        earth = json.loads((ROOT / "data/earth-horizons.json").read_text())
        e, s = parse_horizons(earth, "399"), parse_horizons(self.payload, "10")
        self.assertEqual([r["time_utc"] for r in e], [r["time_utc"] for r in s])
        self.assertLess(e[0]["elevation_deg"], 0)
        self.assertGreater(e[0]["angular_radius_deg"], s[0]["angular_radius_deg"])


if __name__ == "__main__":
    unittest.main()
