import { writable, derived, get } from 'svelte/store';
import { getPublicProvider } from '~/utils/provider';
import { getPoBRegistryContract, REGISTRY_ADDRESSES } from '~/utils/registry';

interface RegistryStatusState {
  initializationComplete: boolean | null;
  registryOwner: string | null;
  loading: boolean;
}

/**
 * Creates a Svelte store for PoBRegistry status.
 * Checks if the PoBRegistry is available on the given chain and loads
 * owner/initialization status.
 *
 * Returns an object with derived stores for each property.
 */
export function createRegistryStatusStore(chainId: number | null) {
  const state = writable<RegistryStatusState>({
    initializationComplete: null,
    registryOwner: null,
    loading: false,
  });

  // Track whether the registry is available (computed from chainId)
  const registryAvailable = Boolean(chainId && REGISTRY_ADDRESSES[chainId]);

  // Track cancellation for async cleanup
  let cancelled = false;

  if (!chainId || !registryAvailable) {
    // No chain or no registry - reset to defaults
    state.set({
      initializationComplete: null,
      registryOwner: null,
      loading: false,
    });
  } else {
    // Load registry status
    const loadRegistryStatus = async () => {
      state.update(s => ({ ...s, loading: true }));
      try {
        const provider = getPublicProvider(chainId);
        if (!provider) return;

        const registry = getPoBRegistryContract(chainId, provider);
        if (!registry) return;

        const [initialized, owner] = await Promise.all([
          registry.initializationComplete(),
          registry.owner(),
        ]);

        if (cancelled) return;
        state.set({
          initializationComplete: Boolean(initialized),
          registryOwner: owner,
          loading: false,
        });
      } catch (error) {
        console.warn('[createRegistryStatusStore] Failed to load registry status:', error);
        if (cancelled) return;
        state.set({
          initializationComplete: null,
          registryOwner: null,
          loading: false,
        });
      }
    };

    loadRegistryStatus();
  }

  // Derived stores for individual fields
  const initializationComplete = derived(state, $s => $s.initializationComplete);
  const registryOwner = derived(state, $s => $s.registryOwner);
  const loading = derived(state, $s => $s.loading);

  return {
    registryAvailable,
    initializationComplete,
    registryOwner,
    loading,
    /** Call this to cancel any in-flight async operations */
    destroy() {
      cancelled = true;
    },
  };
}
