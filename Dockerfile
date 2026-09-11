FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000

FROM base AS builder
RUN npm ci
COPY . .
RUN npm run lint

FROM base AS runtime
COPY --from=builder /app /app
COPY --from=builder /app/node_modules /app/node_modules
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node scripts/check-health.js || exit 1
CMD ["node", "server.js"]