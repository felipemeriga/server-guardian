import { spawn, type ChildProcess } from 'child_process';
import pino from 'pino';

const logger = pino({ name: 'claude' });

interface ClaudeOptions {
  timeoutMs: number;
}

interface SendOptions {
  reset?: boolean;
  filePath?: string;
}

export class ClaudeManager {
  private busy = false;
  private options: ClaudeOptions;
  private currentProcess: ChildProcess | null = null;

  constructor(options: ClaudeOptions) {
    this.options = options;
  }

  isBusy(): boolean {
    return this.busy;
  }

  async send(message: string, opts: SendOptions = {}): Promise<string> {
    this.busy = true;

    try {
      const args = ['-p', '--verbose', '--output-format', 'stream-json'];

      if (!opts.reset) {
        args.push('--continue');
      }

      if (opts.filePath) {
        args.push('--file', opts.filePath);
      }

      args.push(message);

      logger.info({ message: message.slice(0, 100), reset: opts.reset }, 'invoking claude');

      try {
        return await this.spawnClaude(args);
      } catch (err) {
        const errMsg = (err as Error).message || '';
        if (!opts.reset && this.isSessionError(errMsg)) {
          logger.warn('session error detected, retrying without --continue');
          const retryArgs = args.filter((a) => a !== '--continue');
          return await this.spawnClaude(retryArgs);
        }
        throw err;
      }
    } finally {
      this.busy = false;
      this.currentProcess = null;
    }
  }

  private isSessionError(message: string): boolean {
    const patterns = ['session not found', 'auth', 'expired', 'invalid session'];
    return patterns.some((p) => message.toLowerCase().includes(p));
  }

  kill(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
      this.busy = false;
    }
  }

  private spawnClaude(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.env.CLAUDE_CWD || process.env.HOME,
      });
      this.currentProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Claude CLI timed out'));
      }, this.options.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          logger.error({ code, stderr }, 'claude exited with error');
          reject(new Error(`Claude exited with code ${code}: ${stderr}`));
          return;
        }

        const text = this.parseStreamJson(stdout);
        resolve(text);
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private parseStreamJson(raw: string): string {
    const lines = raw.trim().split('\n');
    const texts: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              texts.push(block.text);
            }
          }
        }
        if (event.type === 'result' && event.result) {
          texts.push(event.result);
        }
      } catch {
        // skip non-JSON lines
      }
    }

    return texts.join('\n') || raw;
  }
}
