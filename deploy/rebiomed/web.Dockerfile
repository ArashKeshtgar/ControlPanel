# ReBiomed React client (Create React App), served by nginx, which also
# proxies /api and /uploads to the API so the browser stays on one origin.
FROM node:22-alpine AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
# Publishable (public) key only; empty means checkout shows as unavailable.
ARG REACT_APP_STRIPE_PUBLISHABLE_KEY=""
ENV REACT_APP_STRIPE_PUBLISHABLE_KEY=$REACT_APP_STRIPE_PUBLISHABLE_KEY
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/client/build /usr/share/nginx/html
COPY --from=deploy nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
