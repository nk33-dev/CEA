export class BoundedCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number; expires: number }>();
  private bytes = 0;
  private readonly limits: { count: number; bytes: number; ttl: number };

  constructor(limits: { count: number; bytes: number; ttl: number }) {
    if (limits.count < 1 || !Number.isSafeInteger(limits.count) || limits.bytes < 0 || !Number.isSafeInteger(limits.bytes) || limits.ttl <= 0 || !Number.isFinite(limits.ttl)) throw new RangeError('Invalid cache limits');
    this.limits = limits;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { this.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): boolean {
    this.delete(key);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.bytes) return false;
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expires <= now) this.delete(id);
    while (this.entries.size >= this.limits.count || this.bytes + bytes > this.limits.bytes) {
      this.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, bytes, expires: now + this.limits.ttl });
    this.bytes += bytes;
    return true;
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  clear() { this.entries.clear(); this.bytes = 0; }
}
