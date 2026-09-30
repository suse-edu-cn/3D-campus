/** 低多边形配色(贴合 2.5D 示意图的明亮风格) */
export const PALETTE = {
  bg: 0xaee3f5,
  groundContext: 0xa9c47f,
  groundCampus: 0xb8cb90,
  grass: 0x8fbe63,
  wood: 0x6ea452,
  park: 0x93c066,
  water: 0x4fa3d0,
  roadMajor: 0x5f6873,
  roadMinor: 0x76808a,
  roadPath: 0xc9bb9c,
} as const;

/** 运动场类型 → 颜色(取自 2.5D 示意图的高辨识度配色) */
export const PITCH_COLORS: Record<string, number> = {
  track: 0xc05a4e,
  soccer: 0x4e9e4a,
  basketball: 0xc98d55,
  tennis: 0x4a8fc4,
  badminton: 0x58b0a0,
  volleyball: 0x86b04f,
  table_tennis: 0x9fc4e8,
  multi: 0x8fbf6b,
};

/** 建筑类别 → 墙面/屋顶颜色(校区内) */
export const WALL_COLORS: Record<string, number> = {
  teaching: 0xece5d6,
  dormitory: 0xe4dac8,
  canteen: 0xe9e2ce,
  library: 0xe9ddc8,
  lab: 0xe0e5d8,
  gym: 0xdfe5e9,
  factory: 0xd9d5cb,
  hall: 0xe9e3d3,
  office: 0xe5e1d7,
  service: 0xe0dcd2,
  other: 0xdedbd3,
};

export const ROOF_COLORS: Record<string, number> = {
  teaching: 0xb5a698,
  dormitory: 0xa8b2ba,
  canteen: 0xc2a684,
  library: 0x8d99a6,
  lab: 0x96a89e,
  gym: 0xa9b6bf,
  factory: 0x99a3ab,
  hall: 0xafa190,
  office: 0x9fa8b0,
  service: 0xa8a49a,
  other: 0xa5a29a,
};

/** 校区外建筑(周边城市/邻校)统一中性色 */
export const CONTEXT_WALL = 0xd6d3cb;
export const CONTEXT_ROOF = 0x9c9992;
