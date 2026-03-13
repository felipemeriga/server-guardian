export interface Config {
  allowedNumbers: string[];
  openaiApiKey: string | undefined;
  chunkSize: number;
  maxQueueSize: number;
  chunkDelayMs: number;
  claudeTimeoutMs: number;
  authStatePath: string;
  schedulerPath: string;
}

export function getConfig(): Config {
  const allowedRaw = process.env.WHATSAPP_ALLOWED_NUMBERS;
  if (!allowedRaw) {
    throw new Error('WHATSAPP_ALLOWED_NUMBERS environment variable is required');
  }

  return {
    allowedNumbers: allowedRaw.split(',').map((n) => {
      const trimmed = n.trim();
      return trimmed.includes('@') ? trimmed : `${trimmed}@s.whatsapp.net`;
    }),
    openaiApiKey: process.env.OPENAI_API_KEY,
    chunkSize: 4000,
    maxQueueSize: 5,
    chunkDelayMs: 1000,
    claudeTimeoutMs: 120_000,
    authStatePath: process.env.AUTH_STATE_PATH ?? './auth-state',
    schedulerPath: process.env.SCHEDULER_PATH ?? './data/scheduler.json',
  };
}
