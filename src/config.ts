export interface Config {
  localMode: boolean;
  allowedNumbers: string[];
  openaiApiKey: string | undefined;
  chunkSize: number;
  maxQueueSize: number;
  chunkDelayMs: number;
  claudeTimeoutMs: number;
  authStatePath: string;
  schedulerPath: string;
  internalApiKey: string;
  httpPort: number;
}

export function getConfig(): Config {
  const localMode = process.env.LOCAL_MODE === 'true';
  const allowedRaw = process.env.WHATSAPP_ALLOWED_NUMBERS;

  if (!localMode && !allowedRaw) {
    throw new Error(
      'WHATSAPP_ALLOWED_NUMBERS environment variable is required (or set LOCAL_MODE=true)',
    );
  }

  return {
    localMode,
    allowedNumbers: allowedRaw
      ? allowedRaw.split(',').map((n) => {
          const trimmed = n.trim();
          return trimmed.includes('@') ? trimmed : `${trimmed}@s.whatsapp.net`;
        })
      : [],
    openaiApiKey: process.env.OPENAI_API_KEY,
    chunkSize: 4000,
    maxQueueSize: 5,
    chunkDelayMs: 1000,
    claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '900000', 10),
    authStatePath: process.env.AUTH_STATE_PATH ?? './auth-state',
    schedulerPath: process.env.SCHEDULER_PATH ?? './data/scheduler.json',
    internalApiKey: process.env.INTERNAL_API_KEY ?? '',
    httpPort: parseInt(process.env.HTTP_PORT ?? '3000', 10),
  };
}
