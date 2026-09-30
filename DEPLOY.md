# 部署指南(Cloudflare Pages)

纯静态站点,构建产物 `dist/` 仅约 764KB(含全部数据),无需任何后端。

## 方式一:连接 Git 仓库(推荐)

1. 把本仓库推送到 GitHub / GitLab
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
3. 构建配置:
   - **构建命令**:`npm run build`
   - **输出目录**:`dist`
4. 部署完成后获得 `https://<项目名>.pages.dev`,每次 push 自动重新部署

## 方式二:命令行直接上传

```bash
npm run build
npx wrangler pages deploy dist --project-name suse-yibin-campus-3d
```

首次运行会要求登录 Cloudflare 账号。

## 方式三:仪表盘直接上传

构建后(`npm run build`)把 `dist/` 文件夹拖到
**Workers & Pages → Create → Pages → Upload assets** 即可。

## 大素材放 R2(可选)

当前所有资源都很小,不需要 R2。若未来加入大文件(如照片、全景图):

1. **创建桶**:R2 → Create bucket(如 `campus-assets`)
2. **公开访问**:桶 → Settings → Public access → 绑定自定义域名
   (R2 公开访问需要自定义域名或 `r2.dev` 开发地址)
3. **上传**:`npx wrangler r2 object put campus-assets/xxx.webp --file ./xxx.webp`
4. **前端引用**:资源 URL 写成 `https://<R2域名>/xxx.webp`;
   如需构建期切换,可用环境变量 `VITE_ASSET_BASE` 并在 `src/config.ts` 中拼接

## 注意事项

- 本项目不包含任何密钥;高德 API key 仅存于本地 `.env.local`(已被 gitignore),
  只在开发期脚本 `scripts/amap-check.mjs` 使用,不参与构建
- `satellite-check.html` 是开发期校验工具,位于项目根目录,不会进入 `dist/`
- 数据文件 `public/data/*.geojson` 由 `npm run data:build` 生成,如更新了
  OSM 数据或手工设施(`scripts/build-data.mjs` 中的 MANUAL_* 表)需重新生成
