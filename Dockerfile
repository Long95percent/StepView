FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS web-build
# 前端默认走同源 /api（见 src/browserGatewayApi.js），网关由 nginx 反代，
# 所以这里通常不需要传任何东西。VITE_STEPVIEW_API_URL 只在"前端和网关不同源"
# 时才用，是构建期变量（vite 在 build 时把它内联进产物）。
ARG VITE_STEPVIEW_API_URL=""
ENV VITE_STEPVIEW_API_URL=$VITE_STEPVIEW_API_URL
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

FROM node:22-bookworm-slim AS gateway
WORKDIR /app
ENV NODE_ENV=production
COPY electron ./electron
COPY src ./src
# 建号 CLI：注册默认是关的，加人走 `docker compose exec gateway node scripts/create-account.js`
# （这样不必把注册接口临时开到公网上）。
COPY scripts ./scripts
CMD ["node", "electron/familyServer.js"]
