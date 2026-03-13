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
    let currentText = text;
    let currentJid = jid;
    let currentFilePath = filePath;

    while (true) {
      bridge.recordInvocation();
      const reset = bridge.consumeReset();

      try {
        const response = await claude.send(currentText, { reset, filePath: currentFilePath });

        const chunks = chunkText(response, config.chunkSize);
        for (let i = 0; i < chunks.length; i++) {
          await whatsapp.sendMessage(currentJid, chunks[i]);
          if (i < chunks.length - 1) {
            await sleep(config.chunkDelayMs);
          }
        }
      } catch (err) {
        logger.error({ err }, 'claude invocation failed');
        await whatsapp.sendMessage(currentJid, `Error: ${(err as Error).message}`);
      }

      if (currentFilePath) {
        await cleanupTempFile(currentFilePath);
      }

      // Process next queued message
      const next = bridge.dequeue();
      if (!next) break;
      currentText = next.text;
      currentJid = next.jid;
      currentFilePath = next.filePath;
    }
  }

  function getMessageText(msg: WAMessage): string | null {
    return msg.message?.conversation || msg.message?.extendedTextMessage?.text || null;
  }

  function hasImage(msg: WAMessage): boolean {
    return !!msg.message?.imageMessage;
  }

  function hasAudio(msg: WAMessage): boolean {
    return !!(msg.message?.audioMessage || msg.message?.ptvMessage);
  }

  function getSenderJid(msg: WAMessage): string {
    const jid = msg.key.remoteJid || '';
    // If message is fromMe with a LID, use the first allowed number for replies
    if (msg.key.fromMe && jid.endsWith('@lid')) {
      return config.allowedNumbers[0];
    }
    return jid;
  }

  const whatsapp = new WhatsAppClient({
    authStatePath: config.authStatePath,
    onMessage: (msg: WAMessage) => {
      void handleMessage(msg);
    },
  });

  async function handleMessage(msg: WAMessage) {
    const jid = getSenderJid(msg);
    logger.info({ jid }, 'incoming message');

    // fromMe messages are from the account owner (linked device), always allowed
    if (!msg.key.fromMe && !bridge.isAllowed(jid)) {
      logger.warn({ jid }, 'message from non-allowed number, ignoring');
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
            `Processing previous message, yours is queued (position ${bridge.queueSize()}).`,
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
    const jid = config.allowedNumbers[0];
    if (claude.isBusy()) {
      logger.warn('scheduler fired but Claude is busy, queuing scheduled prompt');
      bridge.enqueue({ text: prompt, jid });
      return;
    }
    void (async () => {
      try {
        await whatsapp.sendTyping(jid);
        await processMessage(prompt, jid);
        await whatsapp.stopTyping(jid);
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
