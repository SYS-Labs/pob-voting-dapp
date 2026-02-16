import { writable, derived } from 'svelte/store';
import type { Provider } from 'ethers';
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

function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  return envBaseUrl ? `${envBaseUrl}/api` : '/api';
}

async function fetchEligibilityFromAPI(
  chainId: number,
  account: string
): Promise<Record<number, CertEligibility>> {
  const baseUrl = getApiBaseUrl();
  const resp = await fetch(`${baseUrl}/certs/${chainId}/eligible/${account}`);
  if (!resp.ok) return {};

  const data = await resp.json();
  const eligibility: Record<number, CertEligibility> = {};

  if (Array.isArray(data.eligibility)) {
    for (const row of data.eligibility) {
      eligibility[row.iteration] = {
        eligible: row.eligible,
        certType: row.certType,
        isProject: row.isProject,
        hasNamedTeamMembers: row.hasNamedTeamMembers,
      };
    }
  }

  return eligibility;
}

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

    // Try API-based eligibility first, fall back to per-iteration RPC
    let eligibility: Record<number, CertEligibility> = {};
    try {
      eligibility = await fetchEligibilityFromAPI(chainId, account);
    } catch {
      // Fallback: per-iteration RPC calls
      for (const iteration of iterations) {
        const hasCert = certs.some((c) => c.iteration === iteration);
        if (!hasCert) {
          const elig = await checkCertEligibility(chainId, iteration, account, provider);
          if (elig) {
            eligibility[iteration] = elig;
          }
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
