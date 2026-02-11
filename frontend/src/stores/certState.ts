import { writable, derived } from 'svelte/store';
import type { Provider, JsonRpcSigner } from 'ethers';
import type { Cert, CertEligibility } from '~/interfaces';
import { getUserCerts, checkCertEligibility, CERT_NFT_ADDRESSES } from '~/utils/certNFT';

interface CertState {
  certs: Cert[];
  eligibility: Record<number, CertEligibility>; // iteration -> eligibility
  loading: boolean;
  error: string | null;
}

const initialState: CertState = {
  certs: [],
  eligibility: {},
  loading: false,
  error: null,
};

export const certStateStore = writable<CertState>(initialState);

export const userCerts = derived(certStateStore, ($s) => $s.certs);
export const certsLoading = derived(certStateStore, ($s) => $s.loading);
export const certsError = derived(certStateStore, ($s) => $s.error);
export const certEligibility = derived(certStateStore, ($s) => $s.eligibility);

export async function loadCertState(
  chainId: number,
  account: string,
  iterations: number[],
  provider: Provider
): Promise<void> {
  if (!CERT_NFT_ADDRESSES[chainId]) return;

  certStateStore.update((s) => ({ ...s, loading: true, error: null }));

  try {
    const certs = await getUserCerts(chainId, account, iterations, provider);

    // Check eligibility for iterations where user has no cert
    const eligibility: Record<number, CertEligibility> = {};
    for (const iteration of iterations) {
      const hasCert = certs.some((c) => c.iteration === iteration);
      if (!hasCert) {
        const elig = await checkCertEligibility(chainId, iteration, account, provider);
        if (elig) {
          eligibility[iteration] = elig;
        }
      }
    }

    certStateStore.set({ certs, eligibility, loading: false, error: null });
  } catch (err) {
    certStateStore.update((s) => ({
      ...s,
      loading: false,
      error: err instanceof Error ? err.message : 'Failed to load certificates',
    }));
  }
}

export function refreshCerts(
  chainId: number,
  account: string,
  iterations: number[],
  provider: Provider
): Promise<void> {
  return loadCertState(chainId, account, iterations, provider);
}

export function resetCertState(): void {
  certStateStore.set(initialState);
}
