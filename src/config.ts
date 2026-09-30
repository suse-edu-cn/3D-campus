/** 校区中心经纬度(OSM bbox 中值),作为本地投影原点 */
export const CAMPUS_CENTER = {
  lat: 28.8087,
  lon: 104.6692,
} as const;

/** 数据文件所在目录(base 为 './' 时相对于页面路径) */
export const DATA_BASE = './data/';

/** 建筑默认层高(米) */
export const FLOOR_HEIGHT = 3.5;

/** 第一人称视点高度(米) */
export const EYE_HEIGHT = 1.7;
