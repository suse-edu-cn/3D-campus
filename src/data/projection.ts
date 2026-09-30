import { CAMPUS_CENTER } from '../config';

/**
 * 本地切平面等距投影:以校区中心为原点,单位为米。
 * 北为 -Z,东为 +X,与小比例尺地图直觉一致。
 */
const LAT0 = CAMPUS_CENTER.lat;
const LON0 = CAMPUS_CENTER.lon;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

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

export function lonLatFromMeters(x: number, z: number): LonLat {
  return {
    lon: LON0 + x / M_PER_DEG_LON,
    lat: LAT0 - z / M_PER_DEG_LAT,
  };
}
