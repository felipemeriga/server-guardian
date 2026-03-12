FROM node:20-slim

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Clean dev dependencies
RUN npm prune --production

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["node", "dist/index.js"]
