import pino from 'pino';
import { getConfig } from './config.js';
import { ClaudeManager } from './claude.js';
import { WhatsAppClient } from './whatsapp.js';
import { Bridge } from './bridge.js';
import { Scheduler } from './scheduler.js';
import {
  chunkText,
  saveImage,
  saveAudio,
  transcribeAudio,
  cleanupTempFile,
  cleanupStaleTempFiles,
} from './media.js';
import type { WAMessage } from '@whiskeysockets/baileys';

const logger = pino({ name: 'main' });

async function main() {
  const config = getConfig();
  const claude = new ClaudeManager({ timeoutMs: config.claudeTimeoutMs });
  const bridge = new Bridge(config);
  const scheduler = new Scheduler(config.schedulerPath);

  // Clean up stale temp files from previous runs
  await cleanupStaleTempFiles();

  // Load scheduler
  await scheduler.load();

  async function processMessage(text: string, jid: string, filePath?: string) {
    bridge.recordInvocation();
    const reset = bridge.consumeReset();

    try {
      const response = await claude.send(text, { reset, filePath });

      const chunks = chunkText(response, config.chunkSize);
      for (let i = 0; i < chunks.length; i++) {
        await whatsapp.sendMessage(jid, chunks[i]);
        if (i < chunks.length - 1) {
          await sleep(config.chunkDelayMs);
        }
      }
    } catch (err) {
      logger.error({ err }, 'claude invocation failed');
      await whatsapp.sendMessage(jid, `Error: ${(err as Error).message}`);
    }

    if (filePath) {
      await cleanupTempFile(filePath);
    }

    // Process queued messages
    const next = bridge.dequeue();
    if (next) {
      await processMessage(next.text, next.jid, next.filePath);
    }
  }

  function getMessageText(msg: WAMessage): string | null {
    return (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      null
    );
  }

  function hasImage(msg: WAMessage): boolean {
    return !!msg.message?.imageMessage;
  }

  function hasAudio(msg: WAMessage): boolean {
    return !!(msg.message?.audioMessage || msg.message?.ptvMessage);
  }

  function getSenderJid(msg: WAMessage): string {
    return msg.key.remoteJid || '';
  }

  const whatsapp = new WhatsAppClient({
    authStatePath: config.authStatePath,
    onMessage: (msg: WAMessage) => {
      void handleMessage(msg);
    },
  });

  async function handleMessage(msg: WAMessage) {
    const jid = getSenderJid(msg);

    if (!bridge.isAllowed(jid)) {
      return;
    }

    await whatsapp.markRead(msg);

    // Handle text messages
    const text = getMessageText(msg);

    if (text) {
      // Check special commands
      const command = bridge.getSpecialCommand(text);

      if (command === 'reset') {
        bridge.setReset();
        await whatsapp.sendMessage(jid, 'Session will be reset on next message.');
        return;
      }

      if (command === 'status') {
        await whatsapp.sendMessage(jid, bridge.getStatus());
        return;
      }

      // Check if Claude is busy
      if (claude.isBusy()) {
        const enqueued = bridge.enqueue({ text, jid });
        if (enqueued) {
          await whatsapp.sendMessage(
            jid,
            `Processing previous message, yours is queued (position ${bridge.queueSize()}).`
          );
        } else {
          await whatsapp.sendMessage(jid, 'Queue full, try again shortly.');
        }
        return;
      }

      await whatsapp.sendTyping(jid);
      await processMessage(text, jid);
      await whatsapp.stopTyping(jid);
      return;
    }

    // Handle images
    if (hasImage(msg)) {
      if (claude.isBusy()) {
        await whatsapp.sendMessage(jid, 'Processing previous message, try again shortly.');
        return;
      }

      await whatsapp.sendTyping(jid);
      const imagePath = await saveImage(msg);
      const caption = msg.message?.imageMessage?.caption || 'Analyze this image';
      await processMessage(caption, jid, imagePath);
      await whatsapp.stopTyping(jid);
      return;
    }

    // Handle voice
    if (hasAudio(msg)) {
      if (!config.openaiApiKey) {
        await whatsapp.sendMessage(jid, 'Voice messages not configured (missing OPENAI_API_KEY).');
        return;
      }

      if (claude.isBusy()) {
        await whatsapp.sendMessage(jid, 'Processing previous message, try again shortly.');
        return;
      }

      await whatsapp.sendTyping(jid);
      try {
        const audioPath = await saveAudio(msg);
        const transcription = await transcribeAudio(audioPath, config.openaiApiKey);
        await cleanupTempFile(audioPath);
        await processMessage(`[Voice message]: ${transcription}`, jid);
      } catch (err) {
        logger.error({ err }, 'voice transcription failed');
        await whatsapp.sendMessage(jid, 'Could not transcribe voice message.');
      }
      await whatsapp.stopTyping(jid);
      return;
    }
  }

  // Start scheduler
  scheduler.startWatching((prompt) => {
    const jid = config.allowedNumbers[0]; // Send to primary number
    void (async () => {
      try {
        const response = await claude.send(prompt);
        const chunks = chunkText(response, config.chunkSize);
        for (let i = 0; i < chunks.length; i++) {
          await whatsapp.sendMessage(jid, chunks[i]);
          if (i < chunks.length - 1) {
            await sleep(config.chunkDelayMs);
          }
        }
      } catch (err) {
        logger.error({ err }, 'scheduled task failed');
      }
    })();
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('shutting down...');
    claude.kill();
    scheduler.stop();
    await whatsapp.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Connect to WhatsApp
  await whatsapp.connect();
  logger.info('claude-whatsapp bridge started');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
