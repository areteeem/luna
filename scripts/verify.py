"""Offline verification of the research package, not the proposed application."""
import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import numpy as np
import rasterio

from manifest import ROOT, entries
from prepare_data import parse_horizons


def strict_json(path: Path):
    def reject(value):
        raise ValueError(f"Nonstandard JSON constant {value} in {path}")
    return json.loads(path.read_text(), parse_constant=reject)


def main(write_report=False):
    checks = []
    for path in sorted(ROOT.rglob("*.json")):
        if ".venv" not in path.parts:
            strict_json(path)
    checks.append("All repository JSON parses without NaN/Infinity")
    expected = strict_json(ROOT / "data/manifest.json")["assets"]
    assert entries() == expected, "Asset inventory/hash mismatch; inspect before updating manifest"
    checks.append(f"{len(expected)} asset paths, sizes and SHA-256 hashes match")
    body_counts = {}
    for body, target in (("sun", "10"), ("earth", "399")):
        rows = parse_horizons(strict_json(ROOT / f"data/{body}-horizons.json"), target)
        assert len(rows) == 49
        body_counts[body] = len(rows)
    normalized = strict_json(ROOT / "data/ephemeris-fixture.json")
    for body, target in (("sun", "10"), ("earth", "399")):
        assert normalized["bodies"][body] == parse_horizons(strict_json(ROOT / f"data/{body}-horizons.json"), target)
    checks.append("Raw and normalized Sun/Earth tables match (49 observations each)")
    meta = strict_json(ROOT / "data/site04-dem-sample.metadata.json")
    with rasterio.open(ROOT / "data/site04-dem-sample.tif") as src:
        assert (src.height, src.width) == (256, 256)
        assert src.res == (5.0, 5.0)
        assert '1737400' in src.crs.to_wkt()
        a = src.read(1, masked=True)
        assert a.count() > 0
        assert abs(float(a.min()) - meta["sample_min_raw"]) < 1e-5
        assert abs(float(a.max()) - meta["sample_max_raw"]) < 1e-5
        raster = {"shape": list(a.shape), "pixel_m": list(src.res), "lunar_radius_m": 1737400,
                  "sample_height_range_m": [float(a.min()), float(a.max())]}
    checks.append("Real DEM crop shape, lunar CRS, resolution and height metadata match")
    with (ROOT / "docs/tasks.csv").open() as f:
        tasks = list(csv.DictReader(f))
    known = set()
    for task in tasks:
        assert task["id"] not in known
        assert float(task["hours"]) > 0
        assert set(filter(None, task["depends_on"].split(";"))) <= known, task["id"]
        known.add(task["id"])
    checks.append(f"{len(tasks)} tasks have unique IDs, positive estimates and acyclic ordered dependencies")
    for path in ROOT.rglob("*.md"):
        if ".venv" in path.parts or "originals" in path.parts:
            continue
        for target in re.findall(r"\]\(([^)]+)\)", path.read_text()):
            if "://" in target or target.startswith("#"):
                continue
            target = unquote(target.split("#")[0])
            assert (path.parent / target).exists(), f"Broken local link: {path}: {target}"
    checks.append("Authored Markdown links resolve locally")
    sources = strict_json(ROOT / "docs/sources.json")
    for source in sources["sources"]:
        if source.get("snapshot"):
            assert (ROOT / source["snapshot"]).exists(), source["id"]
    checks.append("Source register snapshot paths resolve")
    report = {"verified_at_utc": datetime.now(timezone.utc).isoformat(), "scope": "research-package-only",
              "status": "passed", "checks": checks, "ephemeris_rows": body_counts,
              "raster": raster, "tasks": len(tasks),
              "p0_hours_including_reserve": sum(float(t["hours"]) for t in tasks if t["priority"] == "P0"),
              "not_verified": ["Terrain horizons", "Visibility/event accuracy", "Application UI", "Hosting", "Award eligibility"]}
    if write_report:
        (ROOT / "docs/verification.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    for check in checks:
        print("PASS", check)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-report", action="store_true", help="Explicitly update the tracked verification report")
    main(parser.parse_args().write_report)
