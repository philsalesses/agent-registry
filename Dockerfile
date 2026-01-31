FROM node:22-slim AS base
RUN npm install -g pnpm@8.15.0

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/core ./packages/core
COPY packages/api ./packages/api

# Build
RUN pnpm --filter ans-core build
RUN pnpm --filter @agent-registry/api build

# Production stage
FROM node:22-slim AS production
RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/packages/core/package.json ./packages/core/
COPY --from=base /app/packages/core/dist ./packages/core/dist
COPY --from=base /app/packages/api/package.json ./packages/api/
COPY --from=base /app/packages/api/dist ./packages/api/dist
COPY --from=base /app/packages/api/drizzle ./packages/api/drizzle

RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "packages/api/dist/server.js"]
