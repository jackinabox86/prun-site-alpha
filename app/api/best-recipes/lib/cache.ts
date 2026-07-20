interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  // Cleanup old entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

export const apiCache = new SimpleCache();

/** Error that carries an HTTP status + JSON body through getOrCompute */
export class HttpJsonError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "HttpJsonError";
  }
}

const inFlight = new Map<string, Promise<any>>();

/**
 * Cache-or-compute with in-flight deduplication: concurrent requests for the
 * same key share a single computation instead of each one fanning out.
 * Failures are not cached — the next request retries.
 */
export async function getOrCompute<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const cached = apiCache.get<T>(key);
  if (cached !== null) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const result = await fn();
      apiCache.set(key, result, ttlMs);
      return result;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => apiCache.cleanup(), 5 * 60 * 1000);
}
