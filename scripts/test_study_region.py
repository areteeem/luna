from unittest import TestCase

from study_region import region_samples


class StudyRegionTests(TestCase):
    def test_date_line_polygon(self):
        samples = region_samples([[179.99,-.02],[-179.99,-.02],[-179.99,.02],[179.99,.02]])
        self.assertEqual(len(samples),16)
        self.assertTrue(all(abs(lon)>179.99 and abs(lat)<.02 for lat,lon in samples))

    def test_concave_polygon_excludes_notch(self):
        samples = region_samples([[0,0],[.04,0],[.04,.04],[.025,.04],
                                  [.025,.015],[.015,.015],[.015,.04],[0,.04]])
        self.assertTrue(samples)
        self.assertTrue(all(not (.015 < lon < .025 and lat > .015) for lat,lon in samples))

    def test_crossed_polygon_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"cross itself"):
            region_samples([[0,0],[.02,.02],[0,.02],[.02,0]])

    def test_region_search_keeps_landing_separate_from_study_windows(self):
        from unittest.mock import patch
        from site_recommendations import recommend

        def evaluate(payload, cfg, start, ets, step, lat, lon, distance, bearing, site_id, resolution, **kwargs):
            return dict(id=site_id, lat=lat, lon=lon, start=start.isoformat(), distance_km=distance,
                        solar_hours=1.5, reference_solar_hours=1.5, station_access_hours=1,
                        joint_sun_station_hours=1, reference_station_access_hours=1,
                        reference_joint_sun_station_hours=1, terrain_unknown_hours=0, station_unknown_hours=0,
                        ground_m=0, energy_wh=20, reference_energy_wh=20, landing=dict(status="unassessed"))

        with patch("site_recommendations._evaluate_site",side_effect=evaluate), patch(
            "site_recommendations._et_samples",return_value=([],[],1)
        ):
            result = recommend(dict(lat=0,lon=0,duration=2,start="2026-11-14T00:00:00Z",
                                    area_scope="region",region_id="survey",region=[[0,0],[.01,0],[.01,.01],[0,.01]]))
        self.assertEqual(result["same_date_screened_count"], 16)
        self.assertEqual(result["same_date_candidates"], [])
        self.assertEqual(result["region_windows"][0]["passing"], 16)
        self.assertEqual(result["region_id"],"survey")
