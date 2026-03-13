FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG WHATSAPP_ALLOWED_NUMBERS
ARG ANTHROPIC_API_KEY
ARG OPENAI_API_KEY
ARG CLAUDE_CWD=/root
ARG AUTH_STATE_PATH=./auth-state
ARG SCHEDULER_PATH=./data/scheduler.json

ENV WHATSAPP_ALLOWED_NUMBERS=$WHATSAPP_ALLOWED_NUMBERS
ENV ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV CLAUDE_CWD=$CLAUDE_CWD
ENV AUTH_STATE_PATH=$AUTH_STATE_PATH
ENV SCHEDULER_PATH=$SCHEDULER_PATH

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build
RUN npm prune --production

VOLUME ["/app/auth-state", "/app/data"]

CMD ["node", "dist/index.js"]
