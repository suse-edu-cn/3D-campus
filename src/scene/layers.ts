/** 绿地(草地/林地/公园)、水体、运动场图层 */
import * as THREE from 'three';
import { PALETTE, PITCH_COLORS } from './palette';
import { buildFlatLayer } from './flatLayer';
import type { CampusData } from '../data/loader';

const GREEN_COLORS: Record<string, number> = {
  grass: PALETTE.grass,
  wood: PALETTE.wood,
  park: PALETTE.park,
};

export function buildGreen(data: CampusData): THREE.Group {
  return buildFlatLayer(data.green, (kind) => GREEN_COLORS[kind] ?? PALETTE.park, 0.12);
}

export function buildWater(data: CampusData): THREE.Group {
  return buildFlatLayer(data.water, () => PALETTE.water, 0.16, {
    roughness: 0.35,
    metalness: 0.1,
  });
}

export function buildPitch(data: CampusData): THREE.Group {
  // 底层(跑道/围合区)与面层(球场/足球场)分开高度,避免同心面 z-fighting
  return buildFlatLayer(
    data.pitch,
    (kind) => PITCH_COLORS[kind] ?? PITCH_COLORS.multi,
    (kind) => (kind === 'track' || kind === 'multi' ? 0.18 : 0.26),
  );
}
