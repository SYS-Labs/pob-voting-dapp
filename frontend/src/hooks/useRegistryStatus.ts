import { useEffect, useState } from 'react';
import { getPublicProvider } from '~/utils/provider';
import { getPoBRegistryContract, REGISTRY_ADDRESSES } from '~/utils/registry';

interface RegistryStatus {
  registryAvailable: boolean;
  initializationComplete: boolean | null;
  registryOwner: string | null;
  loading: boolean;
}

export function useRegistryStatus(chainId: number | null): RegistryStatus {
  const [initializationComplete, setInitializationComplete] = useState<boolean | null>(null);
  const [registryOwner, setRegistryOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const registryAvailable = Boolean(chainId && REGISTRY_ADDRESSES[chainId]);

  useEffect(() => {
    let isMounted = true;

    if (!chainId || !registryAvailable) {
      setInitializationComplete(null);
      setRegistryOwner(null);
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const loadRegistryStatus = async () => {
      setLoading(true);
      try {
        const provider = getPublicProvider(chainId);
        if (!provider) return;

        const registry = getPoBRegistryContract(chainId, provider);
        if (!registry) return;

        const [initialized, owner] = await Promise.all([
          registry.initializationComplete(),
          registry.owner(),
        ]);

        if (!isMounted) return;
        setInitializationComplete(Boolean(initialized));
        setRegistryOwner(owner);
      } catch (error) {
        console.warn('[useRegistryStatus] Failed to load registry status:', error);
        if (!isMounted) return;
        setInitializationComplete(null);
        setRegistryOwner(null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadRegistryStatus();

    return () => {
      isMounted = false;
    };
  }, [chainId, registryAvailable]);

  return {
    registryAvailable,
    initializationComplete,
    registryOwner,
    loading,
  };
}
