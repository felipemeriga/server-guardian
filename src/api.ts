import express, { type Request, type Response, type NextFunction } from 'express';
import pino from 'pino';
import type { ClaudeManager } from './claude.js';
import type { WhatsAppClient } from './whatsapp.js';
import type { Config } from './config.js';

const logger = pino({ name: 'api' });

interface AskRequestBody {
  prompt: string;
  system?: string;
  timeout?: number;
}

interface NotifyRequestBody {
  message: string;
  number?: string;
}

interface ApiDependencies {
  config: Config;
  claude: ClaudeManager;
  whatsapp: WhatsAppClient;
  startTime: number;
}

export function createApiServer({ config, claude, whatsapp, startTime }: ApiDependencies) {
  const app = express();
  app.use(express.json());

  function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!config.internalApiKey) {
      res.status(500).json({ error: 'INTERNAL_API_KEY not configured' });
      return;
    }

    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${config.internalApiKey}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      whatsapp_connected: whatsapp.isConnected(),
      claude_busy: claude.isBusy(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  app.post('/api/ask', authMiddleware, async (req: Request, res: Response) => {
    const body = req.body as AskRequestBody;

    if (!body.prompt || typeof body.prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required and must be a string' });
      return;
    }

    if (claude.isBusy()) {
      res.status(503).json({ error: 'Claude is busy processing another request' });
      return;
    }

    try {
      logger.info({ prompt: body.prompt.slice(0, 100) }, 'API ask request');
      const response = await claude.askOnce(body.prompt, {
        system: body.system,
        timeout: body.timeout,
      });
      res.json({ response, session_continued: false });
    } catch (err) {
      logger.error({ err }, 'API ask failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/notify', authMiddleware, async (req: Request, res: Response) => {
    const body = req.body as NotifyRequestBody;

    if (!body.message || typeof body.message !== 'string') {
      res.status(400).json({ error: 'message is required and must be a string' });
      return;
    }

    const targetJid =
      body.number === 'default' || !body.number
        ? config.allowedNumbers[0]
        : body.number.includes('@')
          ? body.number
          : `${body.number}@s.whatsapp.net`;

    if (!whatsapp.isConnected()) {
      res.status(503).json({ error: 'WhatsApp not connected' });
      return;
    }

    try {
      await whatsapp.sendMessage(targetJid, body.message);
      logger.info({ jid: targetJid }, 'notification sent via WhatsApp');
      res.json({ sent: true, to: targetJid });
    } catch (err) {
      logger.error({ err }, 'notify failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}
