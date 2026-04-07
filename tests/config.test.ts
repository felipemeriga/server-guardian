import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses single allowed number', async () => {
    process.env.WHATSAPP_ALLOWED_NUMBERS = '5511999999999@s.whatsapp.net';
    const { getConfig } = await import('../src/config.js');
    const config = getConfig();
    expect(config.allowedNumbers).toEqual(['5511999999999@s.whatsapp.net']);
  });

  it('parses comma-separated allowed numbers', async () => {
    process.env.WHATSAPP_ALLOWED_NUMBERS =
      '5511999999999@s.whatsapp.net,5511888888888@s.whatsapp.net';
    const { getConfig } = await import('../src/config.js');
    const config = getConfig();
    expect(config.allowedNumbers).toEqual([
      '5511999999999@s.whatsapp.net',
      '5511888888888@s.whatsapp.net',
    ]);
  });

  it('throws if WHATSAPP_ALLOWED_NUMBERS is missing', async () => {
    delete process.env.WHATSAPP_ALLOWED_NUMBERS;
    const { getConfig } = await import('../src/config.js');
    expect(() => getConfig()).toThrow('WHATSAPP_ALLOWED_NUMBERS');
  });

  it('provides default constants', async () => {
    process.env.WHATSAPP_ALLOWED_NUMBERS = '5511999999999@s.whatsapp.net';
    const { getConfig } = await import('../src/config.js');
    const config = getConfig();
    expect(config.chunkSize).toBe(4000);
    expect(config.maxQueueSize).toBe(5);
    expect(config.chunkDelayMs).toBe(1000);
    expect(config.claudeTimeoutMs).toBe(300000);
  });
});
