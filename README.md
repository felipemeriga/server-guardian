# server-guardian

A centralized AI brain that manages infrastructure and knowledge from WhatsApp. It combines a WhatsApp bridge to Claude Code CLI with an HTTP API so other services (like `infra-agent`) can use the same Claude Code session for LLM reasoning — all on the Max subscription (zero API cost).

## How It Works

The bot runs as a linked WhatsApp Web device on your account. When you send a message to yourself (self-chat), it forwards the text to Claude Code CLI and sends the response back. It supports text, images, and voice messages.

Other services on the same Docker network can also send prompts via the HTTP API (`POST /api/ask`) for stateless LLM reasoning, or push WhatsApp notifications through `POST /api/notify`.

## Features

- **Text messages** — forwarded directly to Claude Code
- **Image messages** — sent to Claude with vision support
- **Voice messages** — transcribed via OpenAI Whisper, then sent to Claude
- **Message queue** — if Claude is busy, messages are queued (up to 5)
- **Session continuity** — conversations persist across messages using `--continue`
- **Chunked responses** — long responses are split at natural boundaries (paragraphs/lines)
- **Scheduler** — schedule prompts to run at specific times
- **HTTP API** — `/api/ask` for stateless LLM reasoning, `/api/health` for health checks, `/api/notify` for WhatsApp alerts

## Architecture

```
                    ┌─────────────────────────────────┐
                    │       server-guardian             │
                    │                                   │
WhatsApp ──────────►│  WhatsApp Client (Baileys)       │
                    │       │                           │
                    │       ▼                           │
                    │  Bridge (queue) ◄── /api/ask ◄───── infra-agent
                    │       │                           │
                    │       ▼              /api/notify ◄── infra-agent
                    │  ClaudeManager                    │
                    │   ├── ask() [--continue, WhatsApp]│
                    │   └── askOnce() [stateless, API]  │
                    │       │                           │
                    │       ▼                           │
                    │  Claude Code CLI (Max subscription)│
                    │   ├── MCP → agentic-rag           │
                    │   └── MCP → infra-agent           │
                    └─────────────────────────────────┘
```

## HTTP API

All endpoints (except `/api/health`) require a Bearer token via the `INTERNAL_API_KEY` env var.

### POST /api/ask

Send a prompt for stateless LLM reasoning (no conversation history).

```json
{
  "prompt": "Analyze these container logs and tell me what's wrong:\n\n<logs here>",
  "system": "You are an infrastructure diagnostic assistant. Be concise.",
  "timeout": 60000
}
```

Response:

```json
{
  "response": "The container is OOM-killed. Memory limit is 256MB but the process...",
  "session_continued": false
}
```

### GET /api/health

```json
{
  "status": "ok",
  "whatsapp_connected": true,
  "claude_busy": false,
  "uptime": 12345
}
```

### POST /api/notify

Send a WhatsApp message through server-guardian.

```json
{
  "message": "Backend container restarted successfully.",
  "number": "default"
}
```

## Special Commands

Send these as regular WhatsApp messages:

- `reset` — resets the Claude session on the next message
- `status` — shows uptime, last invocation time, and queue status

## Environment Variables

| Variable                   | Required | Default                 | Description                                                                                        |
| -------------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `WHATSAPP_ALLOWED_NUMBERS` | Yes      | —                       | Comma-separated phone numbers (e.g. `5519991480101`). The first number is used for self-chat mode. |
| `ANTHROPIC_API_KEY`        | Yes      | —                       | Anthropic API key for Claude Code CLI                                                              |
| `INTERNAL_API_KEY`         | Yes      | —                       | Bearer token for HTTP API auth                                                                     |
| `OPENAI_API_KEY`           | No       | —                       | OpenAI API key for voice message transcription (Whisper)                                           |
| `HTTP_PORT`                | No       | `3000`                  | Port for the HTTP API server                                                                       |
| `CLAUDE_CWD`               | No       | `$HOME`                 | Working directory for Claude CLI                                                                   |
| `AUTH_STATE_PATH`          | No       | `./auth-state`          | Path to WhatsApp auth state                                                                        |
| `SCHEDULER_PATH`           | No       | `./data/scheduler.json` | Path to scheduler JSON file                                                                        |

## MCP Configuration

The Claude Code CLI inside the container reads `~/.claude` from the host. To enable MCP servers, add entries to your host's `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agentic-rag": {
      "type": "sse",
      "url": "http://rag-mcp:8001/sse",
      "headers": {
        "Authorization": "Bearer <RAG_API_KEY>"
      }
    },
    "infra-agent": {
      "type": "sse",
      "url": "http://infra-agent:8002/sse",
      "headers": {
        "Authorization": "Bearer <INFRA_API_KEY>"
      }
    }
  }
}
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Run in dev mode
npm run dev
```

On first run, scan the QR code shown in the terminal with WhatsApp (Linked Devices > Link a Device).

## Docker Deployment

```bash
docker compose up -d
```

Or pull the pre-built image:

```bash
docker pull felipemeriga1/server-guardian:latest
```

The `auth-state` volume persists the WhatsApp session so you only need to scan the QR code once. Check logs for the QR code on first run:

```bash
docker logs -f server-guardian
```

## Project Structure

```
src/
├── index.ts       # Main orchestrator — message routing, HTTP server startup
├── whatsapp.ts    # WhatsApp Web client (Baileys)
├── claude.ts      # Claude Code CLI manager (ask + askOnce)
├── bridge.ts      # Message queue, rate limiting, special commands
├── config.ts      # Environment variable parsing
├── media.ts       # Image/audio handling and transcription
├── api.ts         # HTTP API server (Express)
└── scheduler.ts   # Scheduled prompt execution
```
