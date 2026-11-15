"""Subset of SpiceyPy used by LUNA, delegated to the NAIF WASM runtime."""
import numpy as np
import luna_spice_js as _spice

def furnsh(path):
    _spice.loadKernel(path.rsplit("/", 1)[-1])

def str2et(utc):
    return _spice.et(utc)

def pxform(source, target, et):
    return np.asarray(_spice.frame(source, target, et).to_py()).reshape(3, 3)

def pxfrm2(source, target, from_et, to_et):
    return np.asarray(_spice.frameTimes(source, target, from_et, to_et).to_py()).reshape(3, 3)

def mxv(matrix, vector):
    return np.matmul(matrix, vector)

def spkpos(target, et, frame, correction, observer):
    result = _spice.position(target, et, frame, correction, observer).to_py()
    return np.asarray(result[:3]), result[3]

def spkcpo(target, et, frame, locus, correction, observer, center, observer_frame):
    result = _spice.observerState(target, et, frame, locus, correction, *map(float, observer),
                                  center, observer_frame).to_py()
    return np.asarray(result[:6]), result[6]

def recgeo(vector, radius, flattening):
    return tuple(_spice.geodetic(*map(float, vector), radius, flattening).to_py())
