# syntax=docker/dockerfile:1
#
# Multi-stage build so the image can be produced from a clean clone without
# `npm run build` having been run locally first. The earlier single-stage
# version copied dist/ directly, which is .gitignore'd — so anyone cloning
# the repo and running `docker build .` would hit "COPY dist/ failed" until
# they remembered to build TypeScript by hand. Docker MCP Catalog reviewers
# build from a fresh checkout, so the previous Dockerfile would have failed
# their build step.

# ── Stage 1: compile TypeScript → dist/ ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build

# ── Stage 2: runtime image (no source, no dev deps) ──
FROM node:22-alpine
LABEL io.modelcontextprotocol.server.name="com.scriptivox.www/transcription"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
