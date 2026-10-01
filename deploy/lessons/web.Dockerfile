# Language Lesson Designer (Vue 3 + Vite): a static build served by nginx.
# The router uses hash history, so nginx's default config needs no SPA
# fallback. The edit form's save API is a Vite dev-server plugin and doesn't
# exist in this build; the site is read-only here.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
