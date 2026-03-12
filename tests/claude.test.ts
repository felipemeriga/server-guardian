import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeManager } from '../src/claude.js';

// We test by mocking child_process.spawn
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  const { Readable } = await import('stream');

  function createMockProcess(stdout: string, exitCode = 0) {
    const proc = new EventEmitter() as ReturnType<typeof EventEmitter.prototype.on> & {
      stdout: import('stream').Readable;
      stderr: import('stream').Readable;
      kill: ReturnType<typeof vi.fn>;
    };
    const readable = new Readable({ read() {} });
    readable.push(stdout);
    readable.push(null);
    (proc as Record<string, unknown>).stdout = readable;
    const stderrReadable = new Readable({ read() {} });
    stderrReadable.push(null);
    (proc as Record<string, unknown>).stderr = stderrReadable;
    (proc as Record<string, unknown>).kill = vi.fn();
    setTimeout(() => proc.emit('close', exitCode), 10);
    return proc;
  }

  return {
    spawn: vi.fn(() =>
      createMockProcess(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from Claude"}]}}\n',
      ),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (spawn as any).mock.calls.at(-1);
    expect(call[1]).not.toContain('--continue');
  });
});
