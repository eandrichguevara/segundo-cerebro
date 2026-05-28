# syntax=docker/dockerfile:1
# Stage 1: build
FROM node:22-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY prisma/ ./prisma/
RUN DATABASE_URL=postgresql://placeholder pnpm prisma:generate

COPY src/ ./src/
RUN pnpm build

# Stage 2: runtime
FROM node:22-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

ENV NODE_ENV=production

COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/prisma/ ./prisma/
COPY --from=builder /app/dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/index.js"]
