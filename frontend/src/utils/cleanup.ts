/**
 * LocalStorage Cleanup Utility
 *
 * Removes legacy cache keys from localStorage to prevent conflicts
 * with the new API-based data layer.
 */

const LEGACY_PREFIXES = [
  'pob_block_heights',
  'pob_iteration_cache:',
  'pob_cache_version'
];

/**
 * Remove all legacy cache keys from localStorage
 */
export function cleanupLegacyCache(): void {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    console.log('[Cleanup] Removing legacy cache keys:', keysToRemove);
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}
