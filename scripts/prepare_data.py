"""Normalize preserved Horizons responses. No visibility or terrain model here."""
from __future__ import annotations

import csv
import io
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def parse_horizons(payload: dict, target: str) -> list[dict]:
    if payload.get("error"):
        raise ValueError(f"Horizons API error: {payload['error']}")
    text = payload.get("result", "")
    if text.count("$$SOE") != 1 or text.count("$$EOE") != 1:
        raise ValueError("Expected exactly one Horizons observation table")
    if not re.search(r"Target body name:.*\(" + re.escape(target) + r"\)", text.split("$$SOE")[0]):
        raise ValueError("Target identifier missing from header")
    if "MEAN_ME" not in text or "NO (AIRLESS)" not in text:
        raise ValueError("Unexpected lunar frame or refraction convention")
    header, table = text.split("$$SOE")
    if not all(label in header for label in ("Azi_(a-app)", "Elev_(a-app)", "Ang-diam")):
        raise ValueError("Unexpected table columns")
    table = table.split("$$EOE")[0]
    rows = []
    for raw in csv.reader(io.StringIO(table)):
        if not raw or not raw[0].strip():
            continue
        if len(raw) != 7 or raw[-1].strip():
            raise ValueError("Expected date, two flags, azimuth, elevation, diameter, terminator")
        stamp = datetime.strptime(raw[0].strip(), "%Y-%b-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        az, el, diameter = map(float, raw[3:6])
        if not all(math.isfinite(x) for x in (az, el, diameter)):
            raise ValueError("Non-finite geometry")
        if not (0 <= az <= 360 and -90 <= el <= 90 and diameter > 0):
            raise ValueError("Out-of-range geometry")
        row = {"time_utc": stamp.isoformat().replace("+00:00", "Z"),
               "azimuth_deg": az % 360, "elevation_deg": el,
               "angular_radius_deg": diameter / 7200}
        if rows and row["time_utc"] <= rows[-1]["time_utc"]:
            raise ValueError("Times must be strictly increasing")
        rows.append(row)
    if not rows:
        raise ValueError("Empty observation table")
    return rows


def main() -> None:
    bodies = {}
    for name, target in (("sun", "10"), ("earth", "399")):
        path = ROOT / "data" / f"{name}-horizons.json"
        bodies[name] = parse_horizons(json.loads(path.read_text()), target)
    if [r["time_utc"] for r in bodies["sun"]] != [r["time_utc"] for r in bodies["earth"]]:
        raise ValueError("Sun and Earth timestamps differ")
    retrieval_records = {}
    for name in ("sun", "earth"):
        path = ROOT / "data" / f"{name}-acquisition.json"
        retrieval_records[name] = json.loads(path.read_text()) if path.exists() else {"actual_retrieval_date": "2026-11-14"}
    result = {"schema_version": "research-fixture-v1", "retrieval_records": retrieval_records,
              "mode": "astronomy-only-ingestion-fixture", "frame": "MEAN_ME (Horizons header)",
              "observer": {"longitude_east_deg": 0, "latitude_deg": -89.5, "reference_altitude_km": 0},
              "sample_step_seconds": 3600, "endpoint_included": True,
              "limitations": ["No terrain model", "Not the DEM crop coordinate", "Not an event-accuracy fixture"],
              "bodies": bodies}
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    (out / "ephemeris-fixture.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    with (out / "ephemeris-fixture.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["body", "time_utc", "azimuth_deg", "elevation_deg", "angular_radius_deg"])
        writer.writeheader()
        for body, rows in bodies.items():
            writer.writerows({"body": body, **row} for row in rows)
    print("Normalized", {k: len(v) for k, v in bodies.items()})


if __name__ == "__main__":
    main()
