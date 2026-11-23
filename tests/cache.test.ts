import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedCache } from '../server/cache.ts';

afterEach(() => vi.restoreAllMocks());

describe('bounded preview and transfer caches', () => {
  it('expires on reads even when no new entry has been created', () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new BoundedCache<string>({ count: 2, bytes: 10, ttl: 50 });
    cache.set('a', 'first', 5);
    now = 149;
    expect(cache.get('a')).toBe('first');
    now = 150;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.set('b', 'second', 10)).toBe(true);
  });

  it('evicts least recently used entries for both count and byte limits', () => {
    const cache = new BoundedCache<string>({ count: 2, bytes: 10, ttl: 5000 });
    cache.set('a', 'a', 3);
    cache.set('b', 'b', 3);
    cache.get('a');
    cache.set('c', 'c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('a');
    cache.set('large', 'large', 8);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeUndefined();
    expect(cache.set('oversize', 'no', 11)).toBe(false);
    expect(cache.get('large')).toBe('large');
    cache.delete('large');
    expect(cache.set('replacement', 'yes', 10)).toBe(true);
    cache.clear();
    expect(cache.get('replacement')).toBeUndefined();
  });
});
