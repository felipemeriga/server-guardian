import { describe, it, expect } from 'vitest';
import { Bridge } from '../src/bridge.js';
import type { Config } from '../src/config.js';

const mockConfig: Config = {
  allowedNumbers: ['5511999999999@s.whatsapp.net'],
  openaiApiKey: 'sk-test',
  chunkSize: 4000,
  maxQueueSize: 5,
  chunkDelayMs: 0,
  claudeTimeoutMs: 5000,
  authStatePath: './auth-state',
  schedulerPath: './data/scheduler.json',
};

describe('Bridge', () => {
  it('rejects messages from unauthorized numbers', () => {
    const bridge = new Bridge(mockConfig);
    const allowed = bridge.isAllowed('9999@s.whatsapp.net');
    expect(allowed).toBe(false);
  });

  it('allows messages from whitelisted numbers', () => {
    const bridge = new Bridge(mockConfig);
    const allowed = bridge.isAllowed('5511999999999@s.whatsapp.net');
    expect(allowed).toBe(true);
  });

  it('detects reset command', () => {
    const bridge = new Bridge(mockConfig);
    expect(bridge.getSpecialCommand('reset')).toBe('reset');
    expect(bridge.getSpecialCommand('Reset')).toBe('reset');
    expect(bridge.getSpecialCommand('hello')).toBeNull();
  });

  it('detects status command', () => {
    const bridge = new Bridge(mockConfig);
    expect(bridge.getSpecialCommand('status')).toBe('status');
  });

  it('reports queue position when busy', () => {
    const bridge = new Bridge(mockConfig);
    bridge.enqueue({ text: 'msg1', jid: '5511999999999@s.whatsapp.net' });
    bridge.enqueue({ text: 'msg2', jid: '5511999999999@s.whatsapp.net' });
    expect(bridge.queueSize()).toBe(2);
  });

  it('rejects when queue is full', () => {
    const config = { ...mockConfig, maxQueueSize: 2 };
    const bridge = new Bridge(config);
    const jid = '5511999999999@s.whatsapp.net';
    expect(bridge.enqueue({ text: 'msg1', jid })).toBe(true);
    expect(bridge.enqueue({ text: 'msg2', jid })).toBe(true);
    expect(bridge.enqueue({ text: 'msg3', jid })).toBe(false);
  });

  it('manages reset flag correctly', () => {
    const bridge = new Bridge(mockConfig);
    expect(bridge.consumeReset()).toBe(false);
    bridge.setReset();
    expect(bridge.consumeReset()).toBe(true);
    expect(bridge.consumeReset()).toBe(false);
  });
});
