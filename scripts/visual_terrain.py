"""Display terrain tiles: real LOLA heights relative to the 1,737,400 m sphere.
This display sampler deliberately does not change the science coverage gates.
"""
from functools import lru_cache
import math
import struct
import numpy as np
from terrain_model import ROOT, elevations

@lru_cache(maxsize=1)
def global_grid():
    path = ROOT / 'work/terrain/ldem_16.img'
    if not path.exists() or path.stat().st_size != 33177600:
        raise ValueError('Global LOLA terrain is missing. Run npm run setup:terrain in app/.')
    return np.memmap(path, dtype='<i2', mode='r', shape=(2880, 5760))

def global_heights(lon, lat):
    grid = global_grid()
    column = (np.asarray(lon) % 360) * 16 - .5
    row = np.clip((90 - np.asarray(lat)) * 16 - .5, 0, 2879)
    x = np.floor(column).astype(int); y = np.floor(row).astype(int)
    fx = column - x; fy = row - y
    heights = .5 * (grid[y, x % 5760] * (1-fx)*(1-fy) + grid[y, (x+1) % 5760] * fx*(1-fy) + grid[np.minimum(y+1,2879), x % 5760] * (1-fx)*fy + grid[np.minimum(y+1,2879), (x+1) % 5760] * fx*fy)
    # Every longitude converges to one physical pole; avoid a radial seam there.
    heights = np.where(np.asarray(lat) >= 90-1e-12, float(np.mean(grid[0]))*.5, heights)
    return np.where(np.asarray(lat) <= -90+1e-12, float(np.mean(grid[-1]))*.5, heights)

@lru_cache(maxsize=256)
def tile(level, x, y):
    if not (0 <= level <= 14 and 0 <= x < 2**(level+1) and 0 <= y < 2**level):
        raise ValueError('Invalid terrain tile')
    span = 180 / 2**level
    lon, lat = np.meshgrid(np.linspace(-180+x*span, -180+(x+1)*span, 65), np.linspace(90-y*span, 90-(y+1)*span, 65))
    heights = global_heights(lon, lat)
    # The local rasters use a south-pole projection, singular at the north pole.
    # Sample outside their polar footprint at a finite dummy latitude, then mask it.
    regional, resolution = elevations(lon, np.minimum(lat, -75.))
    covered = (lat <= -75.) & np.isfinite(regional)
    heights = np.where(covered, regional, heights)
    finest = float(np.nanmin(resolution)) if covered.any() else 1895.21
    max_level = min(14, max(6, math.ceil(math.log2(180*30323/(64*finest)))))
    if not np.isfinite(heights).all(): raise ValueError('Non-finite terrain height')
    return struct.pack('<I', max_level) + heights.astype('<f4').tobytes()
