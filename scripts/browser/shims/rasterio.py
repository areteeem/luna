"""Read the verified Float32 lunar DEMs decoded by the web worker."""
from pathlib import Path
from types import SimpleNamespace
import json
import numpy as np

class RasterioError(ValueError):
    pass

errors = SimpleNamespace(RasterioError=RasterioError)

class Raster:
    scales = (1.,)
    offsets = (0.,)
    nodata = float("nan")

    def __init__(self, path):
        self.path = Path(path)
        data = json.loads(self.path.read_text())
        self.shape = (data["height"], data["width"])
        x, y, dx, dy = (data[k] for k in ("x", "y", "dx", "dy"))
        self.transform = SimpleNamespace(a=dx, c=x, e=dy, f=y)
        self.bounds = (x, y + self.shape[0] * dy, x + self.shape[1] * dx, y)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, band):
        if band != 1:
            raise RasterioError("Expected the single lunar elevation band")
        return np.fromfile(str(self.path) + ".bin", dtype="<f4").reshape(self.shape)

def open(path):
    return Raster(path)
