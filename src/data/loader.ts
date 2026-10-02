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

async function fetchLayer<P>(campus: string, file: string): Promise<Feature<P>[]> {
  const res = await fetch(`./data/${campus}/${file}`);
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

import type { ManualState } from '../scene/manual';

export interface CampusInfo {
  id: string;
  name: string;
  camera: { pos: [number, number, number]; target: [number, number, number] };
}

export async function loadCampusRegistry(): Promise<CampusInfo[]> {
  const res = await fetch('./data/campuses.json');
  if (!res.ok) throw new Error(`加载 campuses.json 失败 (HTTP ${res.status})`);
  const j = (await res.json()) as { campuses: CampusInfo[] };
  return j.campuses;
}

export async function loadCampusData(campus: string): Promise<CampusData> {
  const [buildings, roads, water, green, pitch, boundary, poi] = await Promise.all([
    fetchLayer<BuildingProps>(campus, 'buildings.geojson'),
    fetchLayer<RoadProps>(campus, 'roads.geojson'),
    fetchLayer<KindProps>(campus, 'water.geojson'),
    fetchLayer<KindProps>(campus, 'green.geojson'),
    fetchLayer<KindProps>(campus, 'pitch.geojson'),
    fetchLayer<BoundaryProps>(campus, 'boundary.geojson'),
    fetchLayer<PoiProps>(campus, 'poi.geojson'),
  ]);
  return { buildings, roads, water, green, pitch, boundary, poi };
}

export async function loadManual(campus: string): Promise<ManualState> {
  const res = await fetch(`./data/${campus}/manual.json`);
  if (!res.ok) throw new Error(`加载 manual.json 失败 (HTTP ${res.status})`);
  return (await res.json()) as ManualState;
}
