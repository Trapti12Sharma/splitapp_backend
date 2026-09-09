/**
 * Minimal in-process TTL cache with a bounded size.
 *
 * Used for short-lived, cheap-to-rebuild values (the authenticated user document,
 * computed balance maps). Entries expire quickly so a stale read is never more
 * than `ttlMs` old, and the size cap keeps memory flat regardless of user count.
 *
 * Note: this is per-process. With multiple instances behind a load balancer each
 * keeps its own copy, which is fine given the short TTL and the explicit
 * invalidation on writes.
 */
class TTLCache {
  constructor({ ttlMs = 30000, maxSize = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU-ish eviction below.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });

    // Map preserves insertion order, so the first key is the least recently used.
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  delete(key) {
    this.store.delete(key);
  }

  /** Drop every key that starts with `prefix` (used to invalidate a user's entries). */
  deletePrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear() {
    this.store.clear();
  }

  /** Remove expired entries. Called on an interval so idle keys don't linger. */
  prune() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }
}

module.exports = TTLCache;
