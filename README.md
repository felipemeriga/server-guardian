# claude-whatsapp

A WhatsApp bridge that connects your WhatsApp messages to Claude Code CLI. Send a message on WhatsApp, get Claude's response back.

## How It Works

The bot runs as a linked WhatsApp Web device on your account. When you send a message to yourself (self-chat), it forwards the text to Claude Code CLI and sends the response back. It supports text, images, and voice messages.

## Features

- **Text messages** — forwarded directly to Claude Code
- **Image messages** — sent to Claude with vision support
- **Voice messages** — transcribed via OpenAI Whisper, then sent to Claude
- **Message queue** — if Claude is busy, messages are queued (up to 5)
- **Session continuity** — conversations persist across messages using `--continue`
- **Chunked responses** — long responses are split at natural boundaries (paragraphs/lines)
- **Scheduler** — schedule prompts to run at specific times

## Special Commands

Send these as regular WhatsApp messages:

- `reset` — resets the Claude session on the next message
- `status` — shows uptime, last invocation time, and queue status

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_ALLOWED_NUMBERS` | Yes | Comma-separated phone numbers (e.g. `5519991480101`). The first number is used for self-chat mode. |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude Code CLI |
| `OPENAI_API_KEY` | No | OpenAI API key for voice message transcription (Whisper) |
| `CLAUDE_CWD` | No | Working directory for Claude CLI (default: `$HOME`) |
| `AUTH_STATE_PATH` | No | Path to WhatsApp auth state (default: `./auth-state`) |
| `SCHEDULER_PATH` | No | Path to scheduler JSON file (default: `./data/scheduler.json`) |

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
docker build -t claude-whatsapp .
docker run -d \
  -e WHATSAPP_ALLOWED_NUMBERS=5519991480101 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e OPENAI_API_KEY=sk-... \
  -v ./auth-state:/app/auth-state \
  -v ./data:/app/data \
  claude-whatsapp
```

The `auth-state` volume persists the WhatsApp session so you only need to scan the QR code once. Check logs for the QR code on first run:

```bash
docker logs -f <container>
```

## Project Structure

```
src/
├── index.ts       # Main orchestrator — message routing and processing
├── whatsapp.ts    # WhatsApp Web client (Baileys)
├── claude.ts      # Claude Code CLI manager (spawn per message)
├── bridge.ts      # Message queue, rate limiting, special commands
├── config.ts      # Environment variable parsing
├── media.ts       # Image/audio handling and transcription
└── scheduler.ts   # Scheduled prompt execution
```
