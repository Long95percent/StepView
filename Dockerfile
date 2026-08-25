FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS web-build
COPY index.html ./
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
CMD ["node", "electron/familyServer.js"]
