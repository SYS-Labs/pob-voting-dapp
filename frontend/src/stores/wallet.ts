import { writable, derived, get } from 'svelte/store';
import { BrowserProvider, JsonRpcProvider, type JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS } from '~/utils/provider';
import { NETWORKS } from '~/constants/networks';

// ============================================================================
// Types
// ============================================================================

interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  walletAddress: string | null;
  chainId: number | null;
  userDisconnected: boolean;
}

// ============================================================================
// Store
// ============================================================================

const initialState: WalletState = {
  provider: null,
  signer: null,
  walletAddress: null,
  chainId: null,
  userDisconnected: localStorage.getItem('userDisconnected') === 'true',
};

export const walletStore = writable<WalletState>(initialState);

// Derived stores for easy access
export const provider = derived(walletStore, $w => $w.provider);
export const signer = derived(walletStore, $w => $w.signer);
export const walletAddress = derived(walletStore, $w => $w.walletAddress);
export const chainId = derived(walletStore, $w => $w.chainId);
export const isConnected = derived(walletStore, $w => $w.walletAddress !== null);

// ============================================================================
// Actions
// ============================================================================

async function handleAccountsChanged(accounts: unknown) {
  const state = get(walletStore);

  if (!Array.isArray(accounts) || accounts.some((acct) => typeof acct !== 'string')) {
    console.warn('[handleAccountsChanged] Unexpected payload:', accounts);
    walletStore.update(s => ({ ...s, walletAddress: null, signer: null }));
    return;
  }

  if (!accounts.length) {
    walletStore.update(s => ({ ...s, walletAddress: null, signer: null }));
    return;
  }

  const [primaryAccount] = accounts as string[];
  localStorage.setItem('userDisconnected', 'false');

  walletStore.update(s => ({ ...s, userDisconnected: false, walletAddress: primaryAccount }));

  if (state.provider) {
    const nextSigner = await state.provider.getSigner();
    walletStore.update(s => ({ ...s, signer: nextSigner }));
  }
}

function handleChainChanged(hexChainId: unknown) {
  if (typeof hexChainId !== 'string') {
    console.warn('[handleChainChanged] Unexpected payload:', hexChainId);
    return;
  }
  const numericChainId = Number.parseInt(hexChainId, 16);
  walletStore.update(s => ({ ...s, chainId: numericChainId }));
}

export async function connectWallet(): Promise<void> {
  console.log('[connectWallet] Starting wallet connection...');
  const ethereum = window.ethereum;
  if (!ethereum) {
    console.error('[connectWallet] No ethereum provider found');
    throw new Error('No injected wallet detected. Please install a Web3 wallet.');
  }

  try {
    localStorage.setItem('userDisconnected', 'false');
    walletStore.update(s => ({ ...s, userDisconnected: false }));

    const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
    const numericChainId = Number.parseInt(hexChainId, 16);
    console.log('[connectWallet] Chain ID:', numericChainId);

    const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
    const accounts = await nextProvider.send('eth_requestAccounts', []);
    console.log('[connectWallet] Connected to account:', accounts[0]);

    const nextSigner = await nextProvider.getSigner();

    walletStore.set({
      provider: nextProvider,
      signer: nextSigner,
      walletAddress: accounts[0],
      chainId: numericChainId,
      userDisconnected: false,
    });

    console.log('[connectWallet] Connection complete');
  } catch (walletError) {
    console.error('[connectWallet] Error:', walletError);
    throw walletError;
  }
}

export function disconnectWallet(): void {
  console.log('[disconnectWallet] Disconnecting...');
  localStorage.setItem('userDisconnected', 'true');

  walletStore.set({
    provider: null,
    signer: null,
    walletAddress: null,
    chainId: null,
    userDisconnected: true,
  });

  console.log('[disconnectWallet] Disconnected. State cleared.');
}

// Auto-connect on init
export function initWallet(): void {
  const ethereum = window.ethereum;
  const state = get(walletStore);

  if (!ethereum || state.userDisconnected) return;

  void (async () => {
    console.log('[Auto-connect] Checking for existing accounts...');
    try {
      const accounts = await ethereum.request<string[]>({ method: 'eth_accounts' });
      if (!accounts || !accounts.length) {
        console.log('[Auto-connect] No accounts found');
        return;
      }

      console.log('[Auto-connect] Found account, restoring connection...');
      const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
      const numericChainId = Number.parseInt(hexChainId, 16);
      const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
      const nextSigner = await nextProvider.getSigner();

      walletStore.set({
        provider: nextProvider,
        signer: nextSigner,
        walletAddress: accounts[0],
        chainId: numericChainId,
        userDisconnected: false,
      });

      console.log('[Auto-connect] Restored connection');
    } catch (autoConnectError) {
      console.log('[Auto-connect] Failed silently', autoConnectError);
    }
  })();
}

// Setup event listeners
export function setupWalletListeners(): () => void {
  const ethereum = window.ethereum;
  if (!ethereum) return () => {};

  console.log('[Event listeners] Setting up...');

  if (typeof ethereum.on === 'function') {
    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);
  }

  return () => {
    console.log('[Event listeners] Cleaning up...');
    if (typeof ethereum.removeListener === 'function') {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    }
  };
}

// Get public provider for a specific chain
export function getPublicProviderForChain(targetChainId: number): JsonRpcProvider | null {
  const network = NETWORKS[targetChainId];
  if (!network) {
    console.warn('[getPublicProviderForChain] No network config for chainId:', targetChainId);
    return null;
  }
  return new JsonRpcProvider(network.rpcUrl, targetChainId, { staticNetwork: true });
}
