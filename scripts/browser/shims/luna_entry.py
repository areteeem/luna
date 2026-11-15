"""Browser entrypoint for the same Python science implementation as localhost."""
import json
from geometry_server import cached_calculation, load_kernels

def run(operation, raw):
    payload = json.loads(raw)
    try:
        if operation == "geometry":
            result = cached_calculation(raw)
        elif operation == "recommendations":
            from site_recommendations import recommend
            result = recommend(payload)
        elif operation == "routes":
            from surface_routes import plan_route
            result = plan_route(payload)
        elif operation == "terrain":
            from visual_terrain import tile
            return tile(payload["level"], payload["x"], payload["y"])
        else:
            raise ValueError("Unknown browser science operation")
        return json.dumps(result, allow_nan=False, separators=(",", ":"))
    except (ValueError, KeyError, TypeError) as error:
        return json.dumps({"error": str(error)[:300]})
