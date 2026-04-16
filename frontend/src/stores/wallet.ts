import { writable, derived, get } from 'svelte/store';
import { BrowserProvider, JsonRpcProvider, type JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS } from '~/utils/provider';
import { NETWORKS, SYS_COIN_ID, HARDHAT_ID } from '~/constants/networks';

// ============================================================================
// Types
// ============================================================================

export interface WalletProviderOption {
  id: string;
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
  isLegacy: boolean;
}

interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  walletAddress: string | null;
  chainId: number | null;
  userDisconnected: boolean;
  ethereumProvider: EthereumProvider | null;
  selectedWalletInfo: EIP6963ProviderInfo | null;
}

// ============================================================================
// Constants
// ============================================================================

const EIP6963_REQUEST_EVENT = 'eip6963:requestProvider';
const EIP6963_ANNOUNCE_EVENT = 'eip6963:announceProvider';
const SELECTED_WALLET_RDNS_KEY = 'selectedWalletRdns';
const SELECTED_WALLET_NAME_KEY = 'selectedWalletName';
const LEGACY_WALLET_ID = 'legacy-window-ethereum';

// ============================================================================
// Store
// ============================================================================

const initialState: WalletState = {
  provider: null,
  signer: null,
  walletAddress: null,
  chainId: null,
  userDisconnected: localStorage.getItem('userDisconnected') === 'true',
  ethereumProvider: null,
  selectedWalletInfo: null,
};

export const walletStore = writable<WalletState>(initialState);
export const walletProvidersStore = writable<WalletProviderOption[]>([]);

// Derived stores for easy access
export const provider = derived(walletStore, $w => $w.provider);
export const signer = derived(walletStore, $w => $w.signer);
export const walletAddress = derived(walletStore, $w => $w.walletAddress);
export const chainId = derived(walletStore, $w => $w.chainId);
export const selectedWalletInfo = derived(walletStore, $w => $w.selectedWalletInfo);
export const isConnected = derived(walletStore, $w => $w.walletAddress !== null);

// ============================================================================
// EIP-6963 provider discovery
// ============================================================================

let discoveryStarted = false;
let legacyFallbackAdded = false;
let activeProvider: EthereumProvider | null = null;
const providerOptionsById = new Map<string, WalletProviderOption>();

function cloneInfo(info: EIP6963ProviderInfo): EIP6963ProviderInfo {
  return {
    uuid: info.uuid,
    name: info.name,
    icon: info.icon,
    rdns: info.rdns,
  };
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function createFallbackUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `wallet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeProviderInfo(info: Partial<EIP6963ProviderInfo> | undefined): EIP6963ProviderInfo {
  return {
    uuid: safeString(info?.uuid, createFallbackUuid()),
    name: safeString(info?.name, 'Browser Wallet'),
    icon: safeString(info?.icon, ''),
    rdns: safeString(info?.rdns, 'unknown.wallet'),
  };
}

function getProviderOptionId(info: EIP6963ProviderInfo, isLegacy = false): string {
  if (isLegacy) return LEGACY_WALLET_ID;
  return info.uuid || `${info.rdns}:${info.name}`;
}

function syncProviderOptions() {
  const options = Array.from(providerOptionsById.values()).sort((a, b) => {
    if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
    return a.info.name.localeCompare(b.info.name);
  });

  walletProvidersStore.set(options);
}

function addProviderOption(detail: EIP6963ProviderDetail, isLegacy = false): WalletProviderOption | null {
  if (!detail?.provider || typeof detail.provider.request !== 'function') {
    return null;
  }

  const info = normalizeProviderInfo(detail.info);
  const id = getProviderOptionId(info, isLegacy);
  const option: WalletProviderOption = {
    id,
    info,
    provider: detail.provider,
    isLegacy,
  };

  if (!isLegacy && legacyFallbackAdded) {
    for (const [key, existing] of providerOptionsById.entries()) {
      if (existing.isLegacy && existing.provider === detail.provider) {
        providerOptionsById.delete(key);
      }
    }
  }

  providerOptionsById.set(id, option);
  syncProviderOptions();
  return option;
}

function getLegacyWalletName(provider: EthereumProvider): string {
  const flaggedProvider = provider as EthereumProvider & {
    isMetaMask?: boolean;
    isRabby?: boolean;
    isPaliWallet?: boolean;
    isPali?: boolean;
  };

  if (flaggedProvider.isRabby) return 'Rabby Wallet';
  if (flaggedProvider.isPaliWallet || flaggedProvider.isPali) return 'Pali Wallet';
  if (flaggedProvider.isMetaMask) return 'MetaMask';
  return 'Browser Wallet';
}

function getLegacyWalletProvider(): WalletProviderOption | null {
  if (typeof window === 'undefined' || !window.ethereum) return null;

  const existing = Array.from(providerOptionsById.values()).find(
    (option) => option.provider === window.ethereum
  );
  if (existing) return existing;

  return {
    id: LEGACY_WALLET_ID,
    info: {
      uuid: LEGACY_WALLET_ID,
      name: getLegacyWalletName(window.ethereum),
      icon: '',
      rdns: 'legacy.window.ethereum',
    },
    provider: window.ethereum,
    isLegacy: true,
  };
}

function addLegacyFallbackIfUseful() {
  const legacy = getLegacyWalletProvider();
  if (!legacy) return;

  legacyFallbackAdded = true;
  providerOptionsById.set(legacy.id, legacy);
  syncProviderOptions();
}

function handleAnnounceProvider(event: Event) {
  const detail = (event as EIP6963AnnounceProviderEvent).detail;
  addProviderOption(detail);
}

export function requestWalletProviders(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));

  if (legacyFallbackTimer !== null) clearTimeout(legacyFallbackTimer);
  legacyFallbackTimer = setTimeout(() => {
    legacyFallbackTimer = null;
    addLegacyFallbackIfUseful();
  }, 100);
}

let legacyFallbackTimer: ReturnType<typeof setTimeout> | null = null;

export function initWalletDiscovery(): () => void {
  if (typeof window === 'undefined') return () => {};

  if (!discoveryStarted) {
    window.addEventListener(EIP6963_ANNOUNCE_EVENT, handleAnnounceProvider as EventListener);
    discoveryStarted = true;
  }

  requestWalletProviders();

  return () => {
    detachProviderListeners();
    window.removeEventListener(EIP6963_ANNOUNCE_EVENT, handleAnnounceProvider as EventListener);
    discoveryStarted = false;
    if (legacyFallbackTimer !== null) {
      clearTimeout(legacyFallbackTimer);
      legacyFallbackTimer = null;
    }
  };
}

function getStoredWalletRdns(): string | null {
  return localStorage.getItem(SELECTED_WALLET_RDNS_KEY);
}

function getStoredWalletName(): string | null {
  return localStorage.getItem(SELECTED_WALLET_NAME_KEY);
}

function rememberWallet(info: EIP6963ProviderInfo) {
  localStorage.setItem(SELECTED_WALLET_RDNS_KEY, info.rdns);
  localStorage.setItem(SELECTED_WALLET_NAME_KEY, info.name);
}

function findWalletOption(walletId?: string): WalletProviderOption | null {
  const options = get(walletProvidersStore);
  if (walletId) {
    return options.find((option) => option.id === walletId) ?? providerOptionsById.get(walletId) ?? null;
  }

  const state = get(walletStore);
  if (state.ethereumProvider) {
    const active = options.find((option) => option.provider === state.ethereumProvider);
    if (active) return active;
  }

  const storedRdns = getStoredWalletRdns();
  const storedName = getStoredWalletName();
  if (storedRdns) {
    const preferred = options.find((option) => option.info.rdns === storedRdns);
    if (preferred) return preferred;
  }
  if (storedName) {
    const preferred = options.find((option) => option.info.name === storedName);
    if (preferred) return preferred;
  }

  if (options.length === 1) return options[0];

  // Multiple wallets with no stored preference — require explicit user choice.
  // Only fall back to legacy when no EIP-6963 providers were discovered at all.
  if (options.length === 0) return getLegacyWalletProvider();
  return null;
}

export function getSelectedEthereumProvider(): EthereumProvider | null {
  const state = get(walletStore);
  if (state.ethereumProvider) return state.ethereumProvider;

  const selected = findWalletOption();
  return selected?.provider ?? null;
}

function attachProviderListeners(ethereum: EthereumProvider) {
  if (activeProvider === ethereum) return;

  detachProviderListeners();
  activeProvider = ethereum;

  if (typeof ethereum.on === 'function') {
    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);
  }
}

function detachProviderListeners() {
  if (!activeProvider) return;

  if (typeof activeProvider.removeListener === 'function') {
    activeProvider.removeListener('accountsChanged', handleAccountsChanged);
    activeProvider.removeListener('chainChanged', handleChainChanged);
  }

  activeProvider = null;
}

// ============================================================================
// Actions
// ============================================================================

async function handleAccountsChanged(accounts: unknown) {
  const state = get(walletStore);

  if (!Array.isArray(accounts) || accounts.some((acct) => typeof acct !== 'string')) {
    console.warn('[handleAccountsChanged] Unexpected payload:', accounts);
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

async function updateConnectedChain(ethereum: EthereumProvider, numericChainId: number) {
  walletStore.update(s => ({ ...s, chainId: numericChainId }));

  const state = get(walletStore);
  if (state.walletAddress && state.ethereumProvider === ethereum) {
    try {
      const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
      const nextSigner = await nextProvider.getSigner();
      walletStore.update(s => ({ ...s, provider: nextProvider, signer: nextSigner }));
      console.log('[handleChainChanged] Provider/signer rebuilt for chain', numericChainId);
    } catch (err) {
      console.warn('[handleChainChanged] Failed to rebuild provider/signer:', err);
    }
  }
}

function handleChainChanged(hexChainId: unknown) {
  if (typeof hexChainId !== 'string') {
    console.warn('[handleChainChanged] Unexpected payload:', hexChainId);
    return;
  }

  const numericChainId = Number.parseInt(hexChainId, 16);
  const state = get(walletStore);
  // activeProvider is always the provider we attached this listener to.
  // Never fall back to window.ethereum — it may be a different wallet than the one selected.
  const ethereum = state.ethereumProvider ?? activeProvider;

  if (ethereum) {
    void updateConnectedChain(ethereum, numericChainId);
  } else {
    walletStore.update(s => ({ ...s, chainId: numericChainId }));
  }
}

async function refreshChainAfterSwitch(ethereum: EthereumProvider) {
  try {
    const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
    if (typeof hexChainId !== 'string') {
      return;
    }
    await updateConnectedChain(ethereum, Number.parseInt(hexChainId, 16));
  } catch (err) {
    console.warn('[switchToNetwork] Failed to refresh chain after switch:', err);
  }
}

export async function connectWallet(walletId?: string, targetChainId: number = SYS_COIN_ID): Promise<void> {
  console.log('[connectWallet] Starting wallet connection...');
  requestWalletProviders();

  const walletOption = findWalletOption(walletId);
  if (!walletOption) {
    console.error('[connectWallet] No ethereum provider found');
    throw new Error('No injected wallet detected. Please install a Web3 wallet.');
  }

  const ethereum = walletOption.provider;

  // Request permission via raw provider first — avoids ethers wrapping quirks
  // during the wallet authorization step.
  const accounts = await ethereum.request<string[]>({ method: 'eth_requestAccounts' });
  if (!accounts || !accounts.length) {
    throw new Error('Wallet returned no accounts.');
  }
  console.log('[connectWallet] Connected to account:', accounts[0]);

  const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
  const numericChainId = Number.parseInt(hexChainId, 16);
  console.log('[connectWallet] Chain ID:', numericChainId);

  // Permission granted — build ethers provider and signer.
  const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
  const nextSigner = await nextProvider.getSigner();

  // All async steps succeeded — commit side effects atomically,
  // then attach listeners so events only reach a fully-initialized store.
  localStorage.setItem('userDisconnected', 'false');
  rememberWallet(walletOption.info);
  walletStore.set({
    provider: nextProvider,
    signer: nextSigner,
    walletAddress: accounts[0],
    chainId: numericChainId,
    userDisconnected: false,
    ethereumProvider: ethereum,
    selectedWalletInfo: cloneInfo(walletOption.info),
  });
  attachProviderListeners(ethereum);

  // Auto-switch to the requested chain unless local Hardhat is already selected.
  if (numericChainId !== targetChainId && numericChainId !== HARDHAT_ID) {
    console.log('[connectWallet] On different chain, attempting auto-switch...');
    try {
      await switchToNetwork(targetChainId);
    } catch {
      console.log('[connectWallet] Auto-switch declined or failed, user can switch manually');
    }
  }

  console.log('[connectWallet] Connection complete');
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
    ethereumProvider: null,
    selectedWalletInfo: null,
  });

  detachProviderListeners();
  console.log('[disconnectWallet] Disconnected. State cleared.');
}

// Auto-connect on init
export function initWallet(): void {
  const state = get(walletStore);
  if (state.userDisconnected) return;

  void (async () => {
    requestWalletProviders();
    await new Promise(resolve => window.setTimeout(resolve, 150));

    const walletOption = findWalletOption();
    if (!walletOption) return;

    console.log('[Auto-connect] Checking for existing accounts...');
    try {
      const accounts = await walletOption.provider.request<string[]>({ method: 'eth_accounts' });
      if (!accounts || !accounts.length) {
        console.log('[Auto-connect] No accounts found');
        return;
      }

      console.log('[Auto-connect] Found account, restoring connection...');
      const hexChainId = await walletOption.provider.request<string>({ method: 'eth_chainId' });
      const numericChainId = Number.parseInt(hexChainId, 16);
      const nextProvider = createProviderWithoutENS(walletOption.provider, numericChainId);
      const nextSigner = await nextProvider.getSigner();

      rememberWallet(walletOption.info);
      attachProviderListeners(walletOption.provider);

      walletStore.set({
        provider: nextProvider,
        signer: nextSigner,
        walletAddress: accounts[0],
        chainId: numericChainId,
        userDisconnected: false,
        ethereumProvider: walletOption.provider,
        selectedWalletInfo: cloneInfo(walletOption.info),
      });

      console.log('[Auto-connect] Restored connection');
    } catch (autoConnectError) {
      console.log('[Auto-connect] Failed silently', autoConnectError);
    }
  })();
}

export function setupWalletListeners(): () => void {
  const state = get(walletStore);
  if (state.ethereumProvider) {
    console.log('[Event listeners] Setting up...');
    attachProviderListeners(state.ethereumProvider);
  }

  return () => {
    console.log('[Event listeners] Cleaning up...');
    detachProviderListeners();
  };
}

// Switch the wallet to a supported network (EIP-3326 + EIP-3085 fallback)
export async function switchToNetwork(targetChainId: number): Promise<void> {
  const ethereum = getSelectedEthereumProvider();
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
      // Some wallets add the chain but don't auto-switch — retry.
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } else {
      throw err;
    }
  }

  await refreshChainAfterSwitch(ethereum);
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
