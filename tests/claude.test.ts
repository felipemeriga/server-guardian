import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeManager } from '../src/claude.js';

// We test by mocking child_process.spawn
vi.mock('child_process', () => {
  const { EventEmitter } = require('events');
  const { Readable } = require('stream');

  function createMockProcess(stdout: string, exitCode = 0) {
    const proc = new EventEmitter() as any;
    const readable = new Readable({ read() {} });
    readable.push(stdout);
    readable.push(null);
    proc.stdout = readable;
    proc.stderr = new Readable({ read() {} });
    proc.stderr.push(null);
    proc.kill = vi.fn();
    setTimeout(() => proc.emit('close', exitCode), 10);
    return proc;
  }

  return {
    spawn: vi.fn(() =>
      createMockProcess(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from Claude"}]}}\n'
      )
    ),
  };
});

describe('ClaudeManager', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager({ timeoutMs: 5000 });
  });

  it('sends a text message and returns response', async () => {
    const result = await manager.send('hello');
    expect(result).toContain('Hello from Claude');
  });

  it('reports busy when a message is already processing', async () => {
    const first = manager.send('hello');
    expect(manager.isBusy()).toBe(true);
    await first;
    expect(manager.isBusy()).toBe(false);
  });

  it('sends without --continue when reset is true', async () => {
    const { spawn } = await import('child_process');
    await manager.send('hello', { reset: true });
    const call = (spawn as any).mock.calls.at(-1);
    expect(call[1]).not.toContain('--continue');
  });
});
