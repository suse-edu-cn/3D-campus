/** GeoJSON 图层数据加载与类型定义 */

export interface BuildingProps {
  osm_id: string;
  name?: string;
  campus: 'suse' | 'other';
  kind: string;
  levels: number;
  height_m: number;
  desc?: string;
}

export interface RoadProps {
  cls: 'major' | 'minor' | 'path';
  highway: string;
  name?: string;
  tunnel?: number;
  bridge?: number;
}

export interface KindProps {
  name?: string;
  kind?: string;
}

export interface BoundaryProps {
  name?: string;
  is_suse?: number;
}

export interface PoiProps {
  name: string;
  kind: string;
  campus: 'suse' | 'other';
  rot?: number;
}

export type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface Feature<P> {
  type: 'Feature';
  geometry: Geometry;
  properties: P;
}

interface FeatureCollection<P> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

async function fetchLayer<P>(file: string): Promise<Feature<P>[]> {
  const res = await fetch(`./data/${file}`);
  if (!res.ok) throw new Error(`加载 ${file} 失败 (HTTP ${res.status})`);
  const fc = (await res.json()) as FeatureCollection<P>;
  return fc.features;
}

export interface CampusData {
  buildings: Feature<BuildingProps>[];
  roads: Feature<RoadProps>[];
  water: Feature<KindProps>[];
  green: Feature<KindProps>[];
  pitch: Feature<KindProps>[];
  boundary: Feature<BoundaryProps>[];
  poi: Feature<PoiProps>[];
}

export interface SatelliteMeta {
  zoom: number;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  width: number;
  height: number;
  mPerPx: number;
}

/** 卫星底图元信息(可选资源,缺失时回退低多边形地面) */
export async function loadSatelliteMeta(): Promise<SatelliteMeta | null> {
  try {
    const res = await fetch('./assets/satellite-meta.json');
    if (!res.ok) return null;
    return (await res.json()) as SatelliteMeta;
  } catch {
    return null;
  }
}

export async function loadCampusData(): Promise<CampusData> {
  const [buildings, roads, water, green, pitch, boundary, poi] = await Promise.all([
    fetchLayer<BuildingProps>('buildings.geojson'),
    fetchLayer<RoadProps>('roads.geojson'),
    fetchLayer<KindProps>('water.geojson'),
    fetchLayer<KindProps>('green.geojson'),
    fetchLayer<KindProps>('pitch.geojson'),
    fetchLayer<BoundaryProps>('boundary.geojson'),
    fetchLayer<PoiProps>('poi.geojson'),
  ]);
  return { buildings, roads, water, green, pitch, boundary, poi };
}
