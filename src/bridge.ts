import type { Config } from './config.js';

export interface QueuedMessage {
  text: string;
  jid: string;
  filePath?: string;
}

export class Bridge {
  private config: Config;
  private queue: QueuedMessage[] = [];
  private startTime = Date.now();
  private lastInvocation: Date | null = null;
  private pendingReset = false;

  constructor(config: Config) {
    this.config = config;
  }

  isAllowed(jid: string): boolean {
    return this.config.allowedNumbers.includes(jid);
  }

  getSpecialCommand(text: string): 'reset' | 'status' | null {
    const normalized = text.trim().toLowerCase();
    if (normalized === 'reset') return 'reset';
    if (normalized === 'status') return 'status';
    return null;
  }

  setReset(): void {
    this.pendingReset = true;
  }

  consumeReset(): boolean {
    if (this.pendingReset) {
      this.pendingReset = false;
      return true;
    }
    return false;
  }

  enqueue(msg: QueuedMessage): boolean {
    if (this.queue.length >= this.config.maxQueueSize) {
      return false;
    }
    this.queue.push(msg);
    return true;
  }

  dequeue(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  queueSize(): number {
    return this.queue.length;
  }

  recordInvocation(): void {
    this.lastInvocation = new Date();
  }

  getStatus(): string {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const lastInv = this.lastInvocation
      ? this.lastInvocation.toISOString()
      : 'never';

    return [
      `Uptime: ${hours}h ${minutes}m ${seconds}s`,
      `Last Claude invocation: ${lastInv}`,
      `Queue: ${this.queue.length}/${this.config.maxQueueSize}`,
    ].join('\n');
  }
}
