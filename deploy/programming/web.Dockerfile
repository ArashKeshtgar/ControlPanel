# Programming Lesson Designer (Vue 3 + Vite): a static build served by nginx, like the
# English lessons. Hash history, so no SPA fallback is needed. The booklet PDFs are
# printed by that repo's CI and published on GitHub Pages; this build links to them.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright is only for printing the PDFs in CI; skip its browser download here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY . .
ARG PDF_BASE=https://arashkeshtgar.github.io/ProgrammingLessonDesigner/pdf/
RUN VITE_PDF_BASE="$PDF_BASE" npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
