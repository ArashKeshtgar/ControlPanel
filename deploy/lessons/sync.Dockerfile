# Review-progress sync for the lessons app (LanguageLessonDesigner/server):
# zero-dependency Node, one JSON file in /data. The secret key is generated
# into /data/key on first start; read it with
#   docker compose exec lessons-sync cat /data/key
FROM node:22-alpine
WORKDIR /app
COPY server/merge.mjs server/sync.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "sync.mjs"]
