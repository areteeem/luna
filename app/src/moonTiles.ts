export const moonLayers = {
  imagery: { id: "LRO_WAC_Mosaic_Global_303ppd_v02", ext: "jpg", max: 8 },
  elevation: { id: "LRO_LOLA_ClrShade_Global_256ppd_v06", ext: "png", max: 6 },
  hillshade: { id: "LRO_LOLA_Shade_Global_128ppd_v04", ext: "png", max: 5 },
  slope: { id: "LRO_LOLA_ClrSlope_Global_16ppd", ext: "png", max: 2 },
} as const;

export type MoonLayer = keyof typeof moonLayers;

export function moonTileUrl(layer: MoonLayer, hosted: boolean, z: number | string, y: number | string, x: number | string) {
  const { id, ext } = moonLayers[layer];
  const root = hosted
    ? `https://trek.nasa.gov/tiles/Moon/EQ/${id}/1.0.0/default/default028mm`
    : `/api/tiles/${layer}`;
  return `${root}/${z}/${y}/${x}.${ext}`;
}
