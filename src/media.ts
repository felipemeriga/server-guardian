import { writeFile, unlink, readFile, readdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import baileys from '@whiskeysockets/baileys';
const { downloadMediaMessage } = baileys;
import type { WAMessage } from '@whiskeysockets/baileys';
import OpenAI from 'openai';
import pino from 'pino';

const logger = pino({ name: 'media' });

export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, maxLength);

    // Try paragraph boundary
    const paraBreak = slice.lastIndexOf('\n\n');
    if (paraBreak > maxLength * 0.3) {
      chunks.push(remaining.slice(0, paraBreak));
      remaining = remaining.slice(paraBreak + 2);
      continue;
    }

    // Try newline boundary
    const lineBreak = slice.lastIndexOf('\n');
    if (lineBreak > maxLength * 0.3) {
      chunks.push(remaining.slice(0, lineBreak));
      remaining = remaining.slice(lineBreak + 1);
      continue;
    }

    // Hard split
    chunks.push(slice);
    remaining = remaining.slice(maxLength);
  }

  return chunks;
}

export async function saveImage(msg: WAMessage): Promise<string> {
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const path = `/tmp/wa-img-${randomUUID()}.png`;
  await writeFile(path, buffer as Buffer);
  logger.info({ path }, 'saved image');
  return path;
}

export async function saveAudio(msg: WAMessage): Promise<string> {
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const path = `/tmp/wa-voice-${randomUUID()}.ogg`;
  await writeFile(path, buffer as Buffer);
  logger.info({ path }, 'saved audio');
  return path;
}

export async function transcribeAudio(filePath: string, apiKey: string): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const file = await readFile(filePath);
  const blob = new Blob([file], { type: 'audio/ogg' });
  const audioFile = new File([blob], 'audio.ogg', { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
  });

  logger.info({ text: transcription.text.slice(0, 100) }, 'transcribed audio');
  return transcription.text;
}

export async function cleanupTempFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore if already deleted
  }
}

export async function cleanupStaleTempFiles(): Promise<void> {
  try {
    const files = await readdir('/tmp');
    for (const f of files) {
      if (f.startsWith('wa-img-') || f.startsWith('wa-voice-')) {
        await unlink(`/tmp/${f}`);
        logger.info({ file: f }, 'cleaned up stale temp file');
      }
    }
  } catch {
    // /tmp might not be readable in some environments
  }
}
