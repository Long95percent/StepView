# 基础镜像按摘要（digest）固定，不用浮动 tag：
# `node:22-bookworm-slim` 这种 tag 会随上游发版改变内容，等于每次构建都在赌一个别人刚推的镜像。
# 升级方式：docker pull node:22-bookworm-slim
#           docker image inspect node:22-bookworm-slim --format '{{index .RepoDigests 0}}'
# 然后把下面的 sha256 换成新的。
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS dependencies
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
# npm 源。默认走官方源；国内或自建镜像拉不动时用
#   docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
# （compose.yaml 会把这个变量透传进来）。只有前端构建需要装 npm 依赖，网关不用。
ARG NPM_REGISTRY=https://registry.npmjs.org
# --omit=dev：只有桌面端打包才需要的 electron / electron-builder 是 devDependencies，
# 容器这里只构建前端，不需要它们（少了它们构建快很多，网络也稳很多）。
RUN npm ci --omit=dev --registry=$NPM_REGISTRY

FROM dependencies AS web-build
# 前端默认走同源 /api（见 src/browserGatewayApi.js），网关由 nginx 反代，
# 所以这里通常不需要传任何东西。VITE_STEPVIEW_API_URL 只在"前端和网关不同源"
# 时才用，是构建期变量（vite 在 build 时把它内联进产物）。
ARG VITE_STEPVIEW_API_URL=""
ENV VITE_STEPVIEW_API_URL=$VITE_STEPVIEW_API_URL
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
# 以非 root 的 nginx 用户运行：监听 8080（1024 以下只有 root 能绑），
# pid 和缓存目录都换成 nginx 自己能写的位置。
# 前面那层反代（Caddy/宿主机 nginx）指向容器的 8080 即可，宿主机端口不变。
RUN sed -i 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS gateway
WORKDIR /app
ENV NODE_ENV=production HOME=/app
# 服务端只用 Node 内置模块（SQLite 也来自 node:sqlite），所以这里不装任何 npm 依赖；
# 用不到 devDependencies，也就不必为了几个工具把镜像撑大。
COPY --chown=node:node electron ./electron
COPY --chown=node:node src ./src
# 建号 CLI：注册默认是关的，加人走 `docker compose exec gateway node scripts/create-account.js`
# （这样不必把注册接口临时开到公网上）。
COPY --chown=node:node scripts ./scripts
# 非 root 运行。数据目录是外部挂载的 /data，容器里没有任何东西需要 root 权限。
USER node
CMD ["node", "electron/familyServer.js"]
