"""Generate native SPICE/raster reference values for the browser worker tests."""
import base64
import json
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "scripts"))
from geometry_server import calculate, load_kernels
from site_recommendations import recommend
from surface_routes import plan_route
from visual_terrain import tile

base = {"start": "2026-11-14T00:00:00Z", "lat": -89.5, "lon": 0, "duration": 1, "step": 900}
terrain = {"enabled": True, "terrain": True, "horizon_range_km": 10, "horizon_step_deg": 2}
apollo = dict(base, start="1972-12-11T19:54:57Z", lat=20.19, lon=30.77, analysis=terrain)
lro = dict(base, start="2022-11-08T08:00:00Z", duration=7, step=900, satellites=[
    {"id": "lro", "ephemeris": "LRO-2022", "altitude": 50, "inclination": 90, "raan": 0, "phase": 0}])
route = {"lander": [150., -89.8], "stops": [[150., -89.786]], "max_grade_deg": 35,
         "avoid": [[[149.8, -89.7944], [150.2, -89.7944], [150.2, -89.7916], [149.8, -89.7916]]]}
region = dict(base, duration=.25, analysis=terrain, area_scope="region", region_id="example",
              region=[[-.04, -89.52], [.04, -89.52], [.03, -89.48], [-.03, -89.48]])
load_kernels()
jobs = []
for label, kind, handler, payload in [
    ("Horizons polar baseline", "geometry", calculate, base),
    ("Definitive LRO", "geometry", calculate, lro),
    ("Apollo 17 outside DEM coverage", "geometry", calculate, apollo),
    ("Polar horizon and station", "geometry", calculate, dict(base, analysis=terrain)),
    ("Rover with a prohibited area", "routes", plan_route, route),
    ("Drawn study region", "recommendations", recommend, region),
]:
    jobs.append({"label": label, "kind": kind, "payload": payload, "expected": handler(payload)})
tiles = [dict(level=2, x=4, y=1), dict(level=6, x=64, y=62), dict(level=6, x=65, y=62),
         dict(level=10, x=2047, y=1022)]
tiles = [{**item, "expected": base64.b64encode(tile(**item)).decode()} for item in tiles]
target = root / "work/browser-parity.json"
target.write_text(json.dumps({"jobs": jobs, "tiles": tiles}, allow_nan=False))
print("Wrote browser parity fixtures")
