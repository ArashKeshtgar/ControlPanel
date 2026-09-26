FROM node:22 AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx ng build --configuration production

FROM nginx:alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
