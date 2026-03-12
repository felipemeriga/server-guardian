import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, type SchedulerEntry } from '../src/scheduler.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

const testDir = '/tmp/scheduler-test';
const testPath = join(testDir, 'scheduler.json');

describe('Scheduler', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('loads entries from file', async () => {
    const entries: SchedulerEntry[] = [
      { id: '1', time: new Date(Date.now() + 60000).toISOString(), prompt: 'test', repeat: null },
    ];
    await writeFile(testPath, JSON.stringify(entries));

    const scheduler = new Scheduler(testPath);
    await scheduler.load();
    expect(scheduler.getEntries()).toHaveLength(1);
    scheduler.stop();
  });

  it('handles missing file gracefully', async () => {
    const scheduler = new Scheduler(join(testDir, 'nonexistent.json'));
    await scheduler.load();
    expect(scheduler.getEntries()).toHaveLength(0);
    scheduler.stop();
  });

  it('fires callback for due entries', async () => {
    const entries: SchedulerEntry[] = [
      {
        id: '1',
        time: new Date(Date.now() - 1000).toISOString(),
        prompt: 'fire now',
        repeat: null,
      },
    ];
    await writeFile(testPath, JSON.stringify(entries));

    const onFire = vi.fn();
    const scheduler = new Scheduler(testPath);
    await scheduler.load();
    scheduler.checkAndFire(onFire);

    expect(onFire).toHaveBeenCalledWith('fire now');
    scheduler.stop();
  });

  it('removes one-shot entries after firing', async () => {
    const entries: SchedulerEntry[] = [
      {
        id: '1',
        time: new Date(Date.now() - 1000).toISOString(),
        prompt: 'fire once',
        repeat: null,
      },
    ];
    await writeFile(testPath, JSON.stringify(entries));

    const scheduler = new Scheduler(testPath);
    await scheduler.load();
    scheduler.checkAndFire(vi.fn());

    expect(scheduler.getEntries()).toHaveLength(0);
    scheduler.stop();
  });
});
