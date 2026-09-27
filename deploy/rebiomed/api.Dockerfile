# ReBiomed API (Express + TypeScript). Build context: the ReBiomed repo
# (REBIOMED_DIR); this file lives in Control Panel so the app repo isn't
# touched while it's being developed.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Mount points for public listing photos and private verification
# documents, owned by the unprivileged user so fresh volumes are writable.
RUN mkdir -p uploads private-uploads && chown -R node:node uploads private-uploads
USER node
EXPOSE 5000
CMD ["node", "dist/server.js"]
