# 四川轻化工大学宜宾校区 · 3D 交互地图

基于 OpenStreetMap 数据 + Three.js 的低多边形校园三维地图,纯前端,可直接部署到 Cloudflare Pages。

![技术栈](https://img.shields.io/badge/Three.js-0.186-blue) ![构建](https://img.shields.io/badge/Vite-8-purple) ![语言](https://img.shields.io/badge/TypeScript-7-blue)

## 功能

- 全校区 155+ 栋建筑三维建模(按类型配色、程序化窗户贴图)
- 道路三级分层、水系(醉泉湖/翠湖等)、绿地、运动场(篮球/网球/田径等)
- 5 座校门门楼(南门/西大门/西门/东门/东南门)、中心广场与中轴步道
- 点击建筑查看信息面板(名称/类型/楼层/高度/简介)+ 镜头定位
- 三种视角:轨道浏览 / 自动巡游 / 第一人称步行(WASD)
- 建筑与地标名称标签(按距离淡出,可开关)
- 3200+ 棵低多边形树木(绿地内确定性散布)

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

## 构建与部署

```bash
npm run build        # 产物在 dist/,约 764KB
```

部署见 [DEPLOY.md](./DEPLOY.md)。

## 数据管线

| 命令 | 作用 |
|---|---|
| `npm run data:fetch` | 从 Overpass API 拉取完整校区 OSM(已入库,可跳过) |
| `npm run data:build` | OSM → 7+1 层 GeoJSON + 建筑高度赋值(输出 public/data/) |
| `npm run data:satellite` | (可选)拉取高德卫星瓦片拼接底图纹理 |

手工维护的设施在 `scripts/build-data.mjs` 的 `MANUAL_*` 表中(校门、网球场、
室内馆、广场、中轴步道),坐标由官方示意图 + 高德卫星影像校准。

## 目录结构

```
├── scripts/          # 数据管线(Overpass 拉取/转换/卫星校准工具)
├── public/data/      # 构建生成的分层 GeoJSON(入库可直接部署)
├── src/
│   ├── data/         # 加载与投影(WGS-84 → 米制局部坐标)
│   ├── scene/        # 各图层构建(地面/建筑/道路/水体/球场/树木/门楼…)
│   ├── ui/           # 信息面板 / 漫游控制
│   └── main.ts       # 装配入口
├── satellite-check.html  # 开发期卫星底图校验工具(不参与构建)
└── docs/data-report.md   # 数据校对报告
```

## 数据来源与致谢

- 地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者
- 设施校核:高德 POI / 高德卫星影像(仅开发期使用)
- 校园布局参照官方《宜宾校区平面示意图》
