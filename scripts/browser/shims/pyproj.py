"""Browser implementations of the spherical lunar projections used by LUNA.

These three formulas operate on the same
1,737,400 m sphere with the same longitude-first axis order as native PROJ.
"""
from dataclasses import dataclass
from functools import lru_cache
import numpy as np

@dataclass(frozen=True)
class CRS:
    proj: str
    radius: float
    lat: float
    lon: float

    @staticmethod
    def from_proj4(value):
        options = dict(token[1:].split("=", 1) for token in value.split() if "=" in token)
        proj = options["proj"]
        if proj not in {"longlat", "stere", "gnom", "aeqd"}:
            raise ValueError("Unsupported lunar projection")
        return CRS(proj, float(options["R"]), float(options.get("lat_0", 0)), float(options.get("lon_0", 0)))

def forward(crs, lon, lat):
    if crs.proj == "longlat":
        return lon, lat
    p, delta = np.deg2rad(lat), np.deg2rad(lon - crs.lon)
    p0 = np.deg2rad(crs.lat)
    if crs.proj == "stere" and crs.lat == -90:
        rho = 2 * crs.radius * np.tan(np.deg2rad(lat + 90) / 2)
        return np.where(lat < 90, rho * np.sin(delta), np.inf), np.where(lat < 90, rho * np.cos(delta), np.inf)
    x = np.cos(p) * np.sin(delta)
    y = np.cos(p0) * np.sin(p) - np.sin(p0) * np.cos(p) * np.cos(delta)
    dot = np.sin(p0) * np.sin(p) + np.cos(p0) * np.cos(p) * np.cos(delta)
    with np.errstate(divide="ignore", invalid="ignore"):
        if crs.proj == "gnom":
            k = np.where(dot > 1.e-10, 1. / dot, np.inf)
        elif crs.proj == "aeqd":
            sin_c = np.hypot(x, y)
            c = np.arctan2(sin_c, dot)
            k = np.where(sin_c <= 1.e-14, np.where(dot > 0, 1., np.inf), c / sin_c)
        else:
            k = 2. / (1. + dot)
        return crs.radius * k * x, crs.radius * k * y

def inverse(crs, x, y):
    if crs.proj == "longlat":
        return x, y
    q = np.hypot(x, y)
    rho = q / crs.radius
    if crs.proj == "stere" and crs.lat == -90:
        lon = np.rad2deg(np.arctan2(x, y)) + crs.lon
        lat = np.rad2deg(2 * np.arctan(rho / 2)) - 90
    else:
        if crs.proj == "gnom":
            c = np.arctan(rho)
        elif crs.proj == "aeqd":
            c = rho
        else:
            c = 2 * np.arctan(rho / 2)
        p0 = np.deg2rad(crs.lat)
        sin_c, cos_c = np.sin(c), np.cos(c)
        safe = np.where(q == 0, 1., q)
        lat = np.rad2deg(np.arcsin(np.clip(cos_c * np.sin(p0) + y * sin_c * np.cos(p0) / safe, -1., 1.)))
        lon = np.rad2deg(np.arctan2(x * sin_c, q * np.cos(p0) * cos_c - y * np.sin(p0) * sin_c)) + crs.lon
    lon = np.where((lon < -180) | (lon > 180), (lon + 180) % 360 - 180, lon)
    return np.where(q == 0, crs.lon, lon), np.where(q == 0, crs.lat, lat)

class Transformer:
    def __init__(self, src, dst):
        self.source_crs = src
        self.target_crs = dst

    @staticmethod
    @lru_cache(maxsize=128)
    def from_crs(src, dst, always_xy=True):
        if not always_xy or src.radius != dst.radius:
            raise ValueError("Expected lunar longitude-first coordinates on a common sphere")
        return Transformer(src, dst)

    def transform(self, x, y):
        x, y = np.broadcast_arrays(np.asarray(x, dtype=float), np.asarray(y, dtype=float))
        lon, lat = inverse(self.source_crs, x, y)
        dx, dy = forward(self.target_crs, lon, lat)
        return (float(dx), float(dy)) if x.ndim == 0 else (dx, dy)
