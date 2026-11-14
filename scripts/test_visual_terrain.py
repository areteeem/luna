import struct
import unittest
from unittest.mock import patch
import numpy as np
import visual_terrain as terrain

class VisualTerrainTests(unittest.TestCase):
    def setUp(self):
        terrain.tile.cache_clear()

    def test_half_meter_units_and_longitude_seam(self):
        grid = np.broadcast_to(np.arange(5760, dtype=np.int16), (2880,5760))
        with patch.object(terrain, 'global_grid', return_value=grid):
            result = terrain.global_heights(np.array([.03125, -180, 180, 0, 360]), np.zeros(5))
        self.assertEqual(result[0], 0)
        self.assertEqual(result[1], result[2])
        self.assertEqual(result[3], result[4])
        self.assertTrue(np.isfinite(result).all())
        with patch.object(terrain, 'global_grid', return_value=grid):
            poles = terrain.global_heights(np.array([-180.,0.,180.]), np.full(3,90.))
        np.testing.assert_array_equal(poles, np.full(3,poles[0]))

    def test_native_terrain_overrides_global_and_sets_refinement(self):
        grid = np.broadcast_to(np.array(100,dtype=np.int16),(2880,5760))
        def local(lon,lat):
            z=np.full(lon.shape,np.nan); resolution=np.full(lon.shape,np.nan)
            z[60,20]=123.5; resolution[60,20]=5
            return z,resolution
        with patch.object(terrain,'global_grid',return_value=grid),patch.object(terrain,'elevations',side_effect=local):
            blob=terrain.tile(2,0,3)
        self.assertEqual(len(blob),16904)
        self.assertEqual(struct.unpack('<I',blob[:4])[0],14)
        heights=np.frombuffer(blob,dtype='<f4',offset=4).reshape(65,65)
        self.assertEqual(heights[60,20],123.5)
        self.assertEqual(heights[0,0],50)

    def test_adjacent_tiles_share_exact_edges_and_poles_are_finite(self):
        grid=np.broadcast_to(np.arange(5760,dtype=np.int16),(2880,5760))
        def empty(lon,lat):return np.full(lon.shape,np.nan),np.full(lon.shape,np.nan)
        with patch.object(terrain,'global_grid',return_value=grid),patch.object(terrain,'elevations',side_effect=empty):
            a=np.frombuffer(terrain.tile(1,0,0),dtype='<f4',offset=4).reshape(65,65)
            b=np.frombuffer(terrain.tile(1,1,0),dtype='<f4',offset=4).reshape(65,65)
        np.testing.assert_array_equal(a[:,-1],b[:,0])
        self.assertTrue(np.isfinite(a).all())

    def test_invalid_tiles_rejected(self):
        for tile in [(-1,0,0),(15,0,0),(0,2,0),(1,0,2)]:
            with self.assertRaises(ValueError):terrain.tile(*tile)

if __name__=='__main__':unittest.main()
