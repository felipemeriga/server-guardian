import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import pino from 'pino';

const logger = pino({ name: 'scheduler' });

export interface SchedulerEntry {
  id: string;
  time: string; // ISO 8601
  prompt: string;
  repeat: string | null; // cron expression or null
}

export class Scheduler {
  private entries: SchedulerEntry[] = [];
  private filePath: string;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      if (!existsSync(this.filePath)) {
        this.entries = [];
        return;
      }
      const raw = await readFile(this.filePath, 'utf-8');
      this.entries = JSON.parse(raw);
      logger.info({ count: this.entries.length }, 'loaded scheduler entries');
    } catch {
      this.entries = [];
      logger.warn('failed to load scheduler file, starting empty');
    }
  }

  getEntries(): SchedulerEntry[] {
    return [...this.entries];
  }

  checkAndFire(onFire: (prompt: string) => void): void {
    const now = Date.now();
    const due = this.entries.filter((e) => new Date(e.time).getTime() <= now);

    for (const entry of due) {
      logger.info({ id: entry.id, prompt: entry.prompt.slice(0, 50) }, 'firing scheduled entry');
      onFire(entry.prompt);
    }

    // Remove one-shot entries that fired
    this.entries = this.entries.filter((e) => !due.includes(e) || e.repeat !== null);

    if (due.length > 0) {
      this.persist();
    }
  }

  startWatching(onFire: (prompt: string) => void, intervalMs = 30_000): void {
    this.checkInterval = setInterval(() => {
      this.load().then(() => this.checkAndFire(onFire));
    }, intervalMs);

    logger.info({ intervalMs }, 'scheduler watching started');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async persist(): Promise<void> {
    try {
      await writeFile(this.filePath, JSON.stringify(this.entries, null, 2));
    } catch (err) {
      logger.error({ err }, 'failed to persist scheduler');
    }
  }
}
