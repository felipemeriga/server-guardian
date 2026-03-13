FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# Clean dev dependencies
RUN npm prune --production

# Environment variables injected by docker-compose
ENV WHATSAPP_ALLOWED_NUMBERS=""
ENV ANTHROPIC_API_KEY=""
ENV OPENAI_API_KEY=""
ENV CLAUDE_CWD="/root"

# Auth state and scheduler data persist via volumes
VOLUME ["/app/auth-state", "/app/data"]

CMD ["node", "dist/index.js"]
