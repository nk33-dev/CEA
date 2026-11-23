import { describe, expect, it, vi } from 'vitest';

const builds = vi.hoisted(() => ({ started: 0, active: 0, peak: 0, releases: [] as (() => void)[] }));
vi.mock('rolldown', () => ({
  rolldown: async () => {
    builds.started++;
    builds.active++;
    builds.peak = Math.max(builds.peak, builds.active);
    await new Promise<void>(resolve => builds.releases.push(resolve));
    return {
      generate: async () => ({ output: [{ code: 'compiled' }] }),
      close: async () => { builds.active--; },
    };
  },
}));

import { bundle } from '../server/bundler.ts';

describe('preview compilation scheduling', () => {
  it('limits concurrent builds, deduplicates identical sources and reuses completed output', async () => {
    const inputs = Array.from({ length: 5 }, (_, index) => [{ path: 'App.jsx', content: `export default function App(){return ${index}}` }]);
    const tasks = inputs.map(files => bundle('react', '', files, 'App.jsx'));
    expect(bundle('react', '', inputs[0], 'App.jsx')).toBe(tasks[0]);
    expect(builds.started).toBe(2);
    for (let started = 3; started <= 5; started++) {
      builds.releases.shift()!();
      await vi.waitFor(() => expect(builds.started).toBe(started));
    }
    for (const release of builds.releases.splice(0)) release();
    expect((await Promise.all(tasks)).every(result => result.code === 'compiled')).toBe(true);
    expect(builds.peak).toBe(2);
    await bundle('react', '', inputs[0], 'App.jsx');
    expect(builds.started).toBe(5);
    expect(builds.active).toBe(0);
  });
});
