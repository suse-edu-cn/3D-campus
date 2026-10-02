import { CAMPUS_CENTER } from '../config';

/**
 * 本地切平面等距投影:以当前校区中心为原点,单位为米。
 * 北为 -Z,东为 +X。切换校区时通过 setProjectionCenter 更新原点。
 */
let activeCenter: { lat: number; lon: number } = { ...CAMPUS_CENTER };

export function setProjectionCenter(c: { lat: number; lon: number }): void {
  activeCenter = { ...c };
}

export function getProjectionCenter(): { lat: number; lon: number } {
  return { ...activeCenter };
}

export interface LonLat {
  lon: number;
  lat: number;
}

export function metersFromLonLat({ lon, lat }: LonLat): { x: number; z: number } {
  const mLon = 111320 * Math.cos((activeCenter.lat * Math.PI) / 180);
  return {
    x: (lon - activeCenter.lon) * mLon,
    z: -(lat - activeCenter.lat) * 110540,
  };
}

export function lonLatFromMeters(x: number, z: number): LonLat {
  const mLon = 111320 * Math.cos((activeCenter.lat * Math.PI) / 180);
  return {
    lon: activeCenter.lon + x / mLon,
    lat: activeCenter.lat - z / 110540,
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
