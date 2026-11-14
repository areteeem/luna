"""Deterministic interior sampling of a lunar study polygon."""
import math

import numpy as np
from pyproj import CRS, Transformer

from terrain_model import CRS_LL, R
from surface_routes import intersects, point, point_in_polygon


def region_samples(vertices):
    if not isinstance(vertices, list) or not 3 <= len(vertices) <= 2000:
        raise ValueError("A study region needs 3–2,000 vertices.")
    coordinates = [point(vertex) for vertex in vertices]
    # Unit vectors avoid averaging opposite longitude signs at the date line.
    lon, lat = np.radians(np.asarray(coordinates)).T
    x, y, z = np.mean([np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)], axis=1)
    if math.hypot(x,y,z) < 0.1:
        raise ValueError("Draw a smaller study region.")
    center = math.degrees(math.atan2(y,x)), math.degrees(math.atan2(z,math.hypot(x,y)))
    local = CRS.from_proj4(f"+proj=gnom +lat_0={center[1]} +lon_0={center[0]} +R={R} +units=m")
    forward = Transformer.from_crs(CRS_LL,local,always_xy=True)
    inverse = Transformer.from_crs(local,CRS_LL,always_xy=True)
    polygon = list(zip(*forward.transform(*np.asarray(coordinates).T)))
    polygon = [p for i,p in enumerate(polygon) if p != polygon[i-1]]
    if len(polygon) < 3 or not np.isfinite(polygon).all():
        raise ValueError("Draw a local study region with at least three distinct points.")
    walls = list(zip(polygon,polygon[1:]+polygon[:1]))
    for i,(a,b) in enumerate(walls):
        if any(intersects(a,b,*walls[j]) for j in range(i-1)
               if not (j == 0 and i == len(walls)-1)):
            raise ValueError("Use a study region whose boundary does not cross itself.")
    low, high = np.min(polygon,axis=0), np.max(polygon,axis=0)
    if max(high-low) > 150_000:
        raise ValueError("Draw a study region less than 150 km across.")
    samples = []
    # Select evenly spaced points on the interior spans of four scanlines.
    for fraction in (0.125,0.375,0.625,0.875):
        y = low[1]+fraction*(high[1]-low[1])
        crossings = sorted(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]) for a,b in walls
                           if (a[1]>y) != (b[1]>y))
        segments = list(zip(crossings[::2],crossings[1::2]))
        for left,right in sorted(segments,key=lambda span:span[1]-span[0],reverse=True)[:2]:
            for fraction_x in ((0.125,0.375,0.625,0.875) if len(segments)==1 else (0.25,0.75)):
                x = left+fraction_x*(right-left)
                if point_in_polygon(x,y,polygon):
                    samples.append(inverse.transform(x,y))
    if not samples:
        raise ValueError("The study region has no sampleable interior.")
    return [(lat,lon) for lon,lat in samples]
