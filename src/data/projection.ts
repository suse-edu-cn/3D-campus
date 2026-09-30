import { CAMPUS_CENTER } from '../config';

/**
 * 本地切平面等距投影:以校区中心为原点,单位为米。
 * 北为 -Z,东为 +X,与小比例尺地图直觉一致。
 */
const LAT0 = CAMPUS_CENTER.lat;
const LON0 = CAMPUS_CENTER.lon;
export const M_PER_DEG_LAT = 110540;
export const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export interface LonLat {
  lon: number;
  lat: number;
}

export function metersFromLonLat({ lon, lat }: LonLat): { x: number; z: number } {
  return {
    x: (lon - LON0) * M_PER_DEG_LON,
    z: -(lat - LAT0) * M_PER_DEG_LAT,
  };
}

/** WGS-84 bbox → 局部米制 {minX,maxX,minZ,maxZ} */
export function bboxToMeters(bbox: {
  minLon: number; maxLon: number; minLat: number; maxLat: number;
}): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const a = metersFromLonLat({ lon: bbox.minLon, lat: bbox.minLat });
  const b = metersFromLonLat({ lon: bbox.maxLon, lat: bbox.maxLat });
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

export function lonLatFromMeters(x: number, z: number): LonLat {
  return {
    lon: LON0 + x / M_PER_DEG_LON,
    lat: LAT0 - z / M_PER_DEG_LAT,
  };
}
