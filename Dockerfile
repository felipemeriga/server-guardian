# Stage 1: Install claude-code on native ARM platform (avoids QEMU V8 OOM)
FROM --platform=$BUILDPLATFORM node:22-slim AS claude-code-installer
RUN npm install -g @anthropic-ai/claude-code

# Stage 2: Build app on native ARM platform
FROM --platform=$BUILDPLATFORM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build
RUN npm prune --production

# Stage 3: Final amd64 image
FROM --platform=linux/amd64 node:22-slim

# Copy claude-code global install from native stage
COPY --from=claude-code-installer /usr/local/lib/node_modules/@anthropic-ai /usr/local/lib/node_modules/@anthropic-ai
COPY --from=claude-code-installer /usr/local/bin/claude /usr/local/bin/claude

WORKDIR /app

# Copy built app from native stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

VOLUME ["/app/auth-state", "/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw r;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
