# LabFlow React app (Vite), served by nginx, which proxies /api to the API
# the same way the Vite dev server does, so the API needs no CORS policy.
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=deploy nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
