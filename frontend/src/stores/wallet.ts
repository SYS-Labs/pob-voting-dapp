import { writable, derived, get } from 'svelte/store';
import { BrowserProvider, JsonRpcProvider, type JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS } from '~/utils/provider';
import { NETWORKS, SYS_COIN_ID, HARDHAT_ID } from '~/constants/networks';

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

  // Rebuild provider/signer for the new chain if wallet was connected
  const state = get(walletStore);
  if (state.walletAddress && window.ethereum) {
    void (async () => {
      try {
        const nextProvider = createProviderWithoutENS(window.ethereum, numericChainId);
        const nextSigner = await nextProvider.getSigner();
        walletStore.update(s => ({ ...s, provider: nextProvider, signer: nextSigner }));
        console.log('[handleChainChanged] Provider/signer rebuilt for chain', numericChainId);
      } catch (err) {
        console.warn('[handleChainChanged] Failed to rebuild provider/signer:', err);
      }
    })();
  }
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

    // Auto-switch to mainnet if connected on a non-primary chain
    if (numericChainId !== SYS_COIN_ID && numericChainId !== HARDHAT_ID) {
      console.log('[connectWallet] Not on mainnet, attempting auto-switch...');
      try {
        await switchToNetwork(SYS_COIN_ID);
      } catch {
        // User declined or wallet doesn't support it — modal will still offer it
        console.log('[connectWallet] Auto-switch declined or failed, user can switch manually');
      }
    }

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

// Switch the wallet to a supported network (EIP-3326 + EIP-3085 fallback)
export async function switchToNetwork(targetChainId: number): Promise<void> {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error('No wallet detected');

  const network = NETWORKS[targetChainId];
  if (!network) throw new Error(`Unknown network: ${targetChainId}`);

  const hexChainId = `0x${targetChainId.toString(16)}`;

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (err: unknown) {
    const switchErr = err as { code?: number };
    // 4902 = chain not added to the wallet yet → add it first
    if (switchErr?.code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexChainId,
          chainName: network.name,
          nativeCurrency: { name: network.tokenSymbol, symbol: network.tokenSymbol, decimals: 18 },
          rpcUrls: [network.rpcUrl],
          ...(network.explorerUrl ? { blockExplorerUrls: [network.explorerUrl] } : {}),
        }],
      });
    } else {
      throw err;
    }
  }
}

// Cached public providers keyed by chainId
const publicProviderCache = new Map<number, JsonRpcProvider>();

// Get public provider for a specific chain (cached)
export function getPublicProviderForChain(targetChainId: number): JsonRpcProvider | null {
  const cached = publicProviderCache.get(targetChainId);
  if (cached) return cached;

  const network = NETWORKS[targetChainId];
  if (!network) {
    console.warn('[getPublicProviderForChain] No network config for chainId:', targetChainId);
    return null;
  }
  const provider = new JsonRpcProvider(network.rpcUrl, targetChainId, { staticNetwork: true });
  publicProviderCache.set(targetChainId, provider);
  return provider;
}
