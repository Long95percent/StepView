import { defineConfig } from "vite";

/**
 * 开发/构建配置。
 *
 * 网关代理是必须的：前端现在默认走**同源** `/api`（见 src/browserGatewayApi.js）。
 * 生产由 nginx 反代（见 docker/nginx.conf），开发就得由 vite 反代，否则
 * `npm run start:family` 下前端会跑到 :5173 上找 /api，然后 404。
 * 两条路的行为必须一致，否则会出现"容器里好好的、本地起不来"。
 *
 * 注意：构建时的 base 由命令行 `--base ./` 决定（见 package.json），这里不要覆盖。
 * 整个项目没有别的 vite 配置，这个文件只放代理。
 */
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        // 默认打本机的家庭网关；家庭网关跑在 Docker 里而 vite 跑在宿主机时，
        // 用 STEPVIEW_DEV_API_TARGET 指过去。
        target: process.env.STEPVIEW_DEV_API_TARGET || "http://127.0.0.1:3210",
        changeOrigin: true,
      },
    },
  },
});
