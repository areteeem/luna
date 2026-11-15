import { hosted } from "./runtime";
import { browserHeightTile } from "./browserTerrain";
import * as C from "cesium";

export function createLunarTerrain(ellipsoid: C.Ellipsoid, maxLevel: number, onError: (message: string) => void, onCoverage?: (regional: boolean, missing: boolean) => void) {
  const provider = new C.CustomHeightmapTerrainProvider({
    width: 65, height: 65,
    tilingScheme: new C.GeographicTilingScheme({ ellipsoid }),
    callback: () => new Float32Array(65 * 65),
    credit: 'NASA LRO LOLA · LDEM_16 V3.1 · 80S / Site04 where covered',
  });
  let pending = 0;
  let reported = false;
  provider.requestTileGeometry = (x, y, level) => {
    if (pending >= 12) return undefined;
    pending++;
    const tile = hosted ? browserHeightTile(level, x, y).then(({ data, regional, regionalMissing }) => {
      onCoverage?.(regional, regionalMissing);
      return data;
    }) : fetch(`/api/terrain/${level}/${x}/${y}.bin`).then(async (response) => {
      if (!response.ok) {
        const body = await response.text();
        let message = body.trim();
        try { message = JSON.parse(body).error || message; } catch { /* Services may return plain-text errors. */ }
        throw new Error(message || 'Terrain data unavailable');
      }
      return response.arrayBuffer();
    });
    return tile.then((bytes) => {
      if (bytes.byteLength !== 4 + 65 * 65 * 4) throw new Error('Invalid terrain tile');
      const sourceMaxLevel = new DataView(bytes).getUint32(0, true);
      return new C.HeightmapTerrainData({
        buffer: new Float32Array(bytes, 4), width: 65, height: 65,
        childTileMask: level < Math.min(sourceMaxLevel, maxLevel) ? 15 : 0,
      });
    }).catch((error) => {
      if (!reported) { reported = true; onError(String(error)); }
      throw error;
    }).finally(() => { pending--; });
  };
  return provider;
}

export function prefersImageMap() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (memory !== undefined && memory <= 4) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2);
}
