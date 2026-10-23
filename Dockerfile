FROM node:22-slim AS build
WORKDIR /app
COPY web/package*.json web/
COPY server/package*.json server/
RUN cd web && npm ci && cd ../server && npm ci
COPY web web
COPY server server
COPY db db
RUN cd web && npm run build && cd ../server && npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=3001 WEB_DIST=../web/dist
WORKDIR /app/server
COPY --from=build /app/server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist dist
COPY --from=build /app/server/src/seed/data dist/seed/data
COPY --from=build /app/web/dist ../web/dist
COPY db ../db
EXPOSE 3001
CMD ["sh","-c","node dist/migrate.js && node dist/seed/seed.js --catalog && node dist/index.js"]
