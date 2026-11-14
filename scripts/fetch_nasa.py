"""Explicit, bounded downloads for the fixed research fixture only."""
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.windows import Window, bounds

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data"
DEM = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif"
CAP = 64 * 1024 * 1024


def save_json(path: Path, value: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    tmp.replace(path)


def fetch_ephemerides() -> None:
    # No parallel NASA SSD requests. Preserve the complete response and request.
    for name in ("sun", "earth"):
        request_path = RAW / f"{name}-request.json"
        request = json.loads(request_path.read_text())
        if request["url"] != "https://ssd.jpl.nasa.gov/api/horizons.api":
            raise ValueError("Unexpected endpoint")
        response = requests.get(request["url"], params=request["params"], timeout=(7, 30))
        response.raise_for_status()
        if len(response.content) > 2 * 1024 * 1024:
            raise ValueError("Unexpected ephemeris size")
        payload = response.json()
        if payload.get("error") or "$$SOE" not in payload.get("result", ""):
            raise ValueError("Horizons returned an error or no table")
        save_json(RAW / f"{name}-horizons.json", payload)
        save_json(RAW / f"{name}-acquisition.json", {
            "retrieved_at_utc": datetime.now(timezone.utc).isoformat(), "source_url": response.url,
            "response_bytes": len(response.content), "note": "Refresh; review changed headers and hashes."})
        print("Downloaded", name)


def fetch_dem() -> None:
    # Site04 is a modest strip TIFF. A full capped transfer is more reliable than remote windows here.
    with tempfile.TemporaryDirectory(prefix="lunar-window-") as directory:
        source = Path(directory) / "source.tif"
        digest = hashlib.sha256()
        size = 0
        with requests.get(DEM, stream=True, timeout=(7, 30)) as response:
            response.raise_for_status()
            if int(response.headers.get("Content-Length", "0")) > CAP:
                raise ValueError("DEM exceeds download cap")
            with source.open("wb") as f:
                for chunk in response.iter_content(1024 * 1024):
                    size += len(chunk)
                    if size > CAP:
                        raise ValueError("DEM exceeds download cap")
                    f.write(chunk)
                    digest.update(chunk)
        with rasterio.open(source) as src:
            if src.width < 256 or src.height < 256:
                raise ValueError("Unexpected raster dimensions")
            window = Window(src.width // 2 - 128, src.height // 2 - 128, 256, 256)
            values = src.read(1, window=window)
            profile = src.profile.copy()
            profile.update(width=256, height=256, transform=src.window_transform(window),
                           driver="GTiff", compress="deflate")
            out = RAW / "site04-dem-sample.tif"
            tmp = out.with_suffix(".tmp.tif")
            with rasterio.open(tmp, "w", **profile) as dst:
                dst.write(values, 1)
            tmp.replace(out)
            mask = np.isfinite(values)
            if src.nodata is not None and np.isfinite(src.nodata):
                mask &= values != src.nodata
            if not mask.any():
                raise ValueError("No valid heights in sample")
            metadata = {"source_url": DEM, "source_bytes": size, "source_sha256": digest.hexdigest(),
                "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
                "source_shape": [src.height, src.width], "source_crs_wkt": src.crs.to_wkt(),
                "window": [window.col_off, window.row_off, window.width, window.height],
                "sample_pixel_m": list(src.res), "sample_shape": [256, 256],
                "source_scales": list(src.scales), "source_offsets": list(src.offsets),
                "source_nodata": float(src.nodata) if src.nodata is not None and np.isfinite(src.nodata) else None,
                "nodata_description": "NaN" if src.nodata is not None and np.isnan(src.nodata) else str(src.nodata),
                "sample_min_raw": float(values[mask].min()), "sample_max_raw": float(values[mask].max()),
                "sample_bounds_m": list(bounds(window, src.transform)),
                "purpose": "Ingestion fixture; insufficient extent for a complete horizon."}
            save_json(out.with_suffix(".metadata.json"), metadata)
    print("Downloaded and cropped Site04 DEM")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ephemerides", action="store_true")
    parser.add_argument("--dem", action="store_true")
    args = parser.parse_args()
    if not args.ephemerides and not args.dem:
        parser.error("Select --ephemerides and/or --dem explicitly")
    if args.ephemerides:
        fetch_ephemerides()
    if args.dem:
        fetch_dem()
