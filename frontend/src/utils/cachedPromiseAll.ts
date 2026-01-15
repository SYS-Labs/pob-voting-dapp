import type { JsonRpcProvider } from 'ethers';

interface CacheEntry {
  blockNumber: number;
  data: any;
  timestamp: number;
}

interface CachedCall {
  key: string;
  promise: Promise<any>;
  skipCache?: boolean; // For mutations or non-cacheable calls
}

/**
 * Simplified RPC Cache
 *
 * - In-memory only (no localStorage persistence)
 * - Block-height-based cache invalidation
 * - In-flight request deduplication
 *
 * Note: localStorage persistence removed as part of API migration.
 * Display data now comes from API indexer; this cache is only used
 * for user-specific RPC calls (badges, roles, votes).
 */
class RPCCache {
  private cache = new Map<string, CacheEntry>();
  private currentBlock: { [chainId: number]: number } = {};
  private readonly maxAge = 60000; // 60 seconds max age
  private inFlight = new Map<string, Promise<any>>(); // Track in-flight requests

  get(chainId: number, key: string): any | null {
    const cacheKey = `${chainId}:${key}`;
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    const currentBlock = this.currentBlock[chainId] || 0;
    const now = Date.now();

    // Invalidate if wrong block or too old
    if (entry.blockNumber !== currentBlock || now - entry.timestamp > this.maxAge) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.data;
  }

  getInFlight(chainId: number, key: string): Promise<any> | null {
    const cacheKey = `${chainId}:${key}`;
    return this.inFlight.get(cacheKey) || null;
  }

  setInFlight(chainId: number, key: string, promise: Promise<any>): void {
    const cacheKey = `${chainId}:${key}`;
    this.inFlight.set(cacheKey, promise);
  }

  clearInFlight(chainId: number, key: string): void {
    const cacheKey = `${chainId}:${key}`;
    this.inFlight.delete(cacheKey);
  }

  set(chainId: number, key: string, blockNumber: number, data: any): void {
    const cacheKey = `${chainId}:${key}`;
    this.cache.set(cacheKey, {
      blockNumber,
      data,
      timestamp: Date.now(),
    });
  }

  updateBlock(chainId: number, blockNumber: number): void {
    const current = this.currentBlock[chainId] || 0;
    if (blockNumber > current) {
      console.log(`[RPCCache] Block updated for chain ${chainId}: ${current} → ${blockNumber}`);
      this.currentBlock[chainId] = blockNumber;

      // Clean old entries for this chain
      const prefix = `${chainId}:`;
      for (const [key, entry] of this.cache.entries()) {
        if (key.startsWith(prefix) && entry.blockNumber < blockNumber) {
          this.cache.delete(key);
        }
      }
    }
  }

  getBlock(chainId: number): number {
    return this.currentBlock[chainId] || 0;
  }

  clear(chainId?: number): void {
    if (chainId !== undefined) {
      const prefix = `${chainId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
      delete this.currentBlock[chainId];
    } else {
      this.cache.clear();
      this.currentBlock = {};
    }
  }
}

export const rpcCache = new RPCCache();

/**
 * Smart Promise.all that integrates caching with block height awareness
 *
 * Usage:
 * const results = await cachedPromiseAll(provider, chainId, [
 *   { key: 'projectCount', promise: contract.projectCount() },
 *   { key: 'isActive', promise: contract.isActive() },
 *   { key: 'votingEnded', promise: contract.votingEnded() },
 * ]);
 */
export async function cachedPromiseAll(
  provider: JsonRpcProvider | null,
  chainId: number | null,
  calls: CachedCall[]
): Promise<any[]> {
  if (!provider || !chainId) {
    // No caching without provider/chainId, just run promises
    return Promise.all(calls.map(c => c.promise));
  }

  console.log(`[Cache] Checking ${calls.length} calls:`, calls.map(c => c.key));

  // Check cache for all calls
  const results: any[] = [];
  const misses: { index: number; call: CachedCall }[] = [];
  const inFlightHits: { index: number; call: CachedCall; promise: Promise<any> }[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];

    if (call.skipCache) {
      misses.push({ index: i, call });
      continue;
    }

    // Check completed cache first
    const cached = rpcCache.get(chainId, call.key);
    if (cached !== null) {
      console.log(`[Cache HIT] ${call.key}`);
      results[i] = cached;
      continue;
    }

    // Check in-flight requests
    const inFlight = rpcCache.getInFlight(chainId, call.key);
    if (inFlight !== null) {
      console.log(`[In-Flight HIT] ${call.key}`);
      inFlightHits.push({ index: i, call, promise: inFlight });
      continue;
    }

    misses.push({ index: i, call });
  }

  // Await in-flight requests if any
  if (inFlightHits.length > 0) {
    console.log(`[Cache] ${inFlightHits.length} in-flight requests, awaiting...`);
    const inFlightResults = await Promise.all(inFlightHits.map(hit => hit.promise));
    for (let i = 0; i < inFlightHits.length; i++) {
      results[inFlightHits[i].index] = inFlightResults[i];
    }
  }

  // If all cached or in-flight, return immediately
  if (misses.length === 0) {
    if (inFlightHits.length === 0) {
      console.log('[Cache] All calls served from cache, no RPC needed');
    }
    return results;
  }

  console.log(`[Cache] ${misses.length} cache misses, fetching from RPC...`);
  console.log(`[Cache] Missing keys:`, misses.map(m => m.call.key));

  // Mark these calls as in-flight BEFORE starting them
  for (const miss of misses) {
    rpcCache.setInFlight(chainId, miss.call.key, miss.call.promise);
  }

  // Fetch block number + missing calls
  const fetchPromises = [
    provider.getBlockNumber(),
    ...misses.map(m => m.call.promise),
  ];

  try {
    const fetchResults = await Promise.all(fetchPromises);
    const blockNumber = fetchResults[0] as number;

    // Update block height
    rpcCache.updateBlock(chainId, blockNumber);

    // Store results in cache and populate return array
    for (let i = 0; i < misses.length; i++) {
      const miss = misses[i];
      const data = fetchResults[i + 1]; // +1 because [0] is block number

      if (!miss.call.skipCache) {
        rpcCache.set(chainId, miss.call.key, blockNumber, data);
      }

      results[miss.index] = data;

      // Clear in-flight marker
      rpcCache.clearInFlight(chainId, miss.call.key);
    }

    return results;
  } catch (error) {
    // Clear in-flight markers on error
    for (const miss of misses) {
      rpcCache.clearInFlight(chainId, miss.call.key);
    }
    throw error;
  }
}

/**
 * Force refresh cache by invalidating current block
 */
export function invalidateCache(chainId?: number): void {
  rpcCache.clear(chainId);
}
