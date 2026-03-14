FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build
RUN npm prune --production

VOLUME ["/app/auth-state", "/app/data"]

CMD ["node", "dist/index.js"]
