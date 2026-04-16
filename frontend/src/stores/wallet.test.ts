import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockEthereum = {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

function makeMockEthereum(overrides: Partial<MockEthereum> = {}): MockEthereum {
  return {
    request: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'ethereum', { value: undefined, writable: true, configurable: true });
});

// ── EIP-6963 discovery ───────────────────────────────────────────────────────

describe('wallet provider discovery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('collects announced EIP-6963 providers', async () => {
    const eth = makeMockEthereum();
    const { initWalletDiscovery, walletProvidersStore } = await import('./wallet');
    const cleanup = initWalletDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: {
          uuid: 'rabby-uuid',
          name: 'Rabby Wallet',
          icon: '',
          rdns: 'io.rabby',
        },
        provider: eth,
      },
    }));

    const wallets = get(walletProvidersStore);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].id).toBe('rabby-uuid');
    expect(wallets[0].info.name).toBe('Rabby Wallet');

    cleanup();
  });

  it('connects using the selected EIP-6963 provider instead of window.ethereum', async () => {
    setupProviderMock();
    const metaMask = makeMockEthereum({
      request: vi.fn().mockResolvedValue('0x39'),
    });
    const rabby = makeMockEthereum({
      request: vi.fn()
        .mockResolvedValueOnce(['0xRabbyAddr'])  // eth_requestAccounts
        .mockResolvedValueOnce('0x39'),          // eth_chainId
    });
    Object.defineProperty(window, 'ethereum', { value: metaMask, writable: true, configurable: true });

    const { initWalletDiscovery, connectWallet } = await import('./wallet');
    const cleanup = initWalletDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: {
          uuid: 'rabby-uuid',
          name: 'Rabby Wallet',
          icon: '',
          rdns: 'io.rabby',
        },
        provider: rabby,
      },
    }));

    await connectWallet('rabby-uuid');

    expect(rabby.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(rabby.request).toHaveBeenCalledWith({ method: 'eth_chainId' });
    expect(metaMask.request).not.toHaveBeenCalled();

    cleanup();
  });
});

// ── switchToNetwork ───────────────────────────────────────────────────────────

describe('switchToNetwork', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls wallet_switchEthereumChain with the correct hex chain ID', async () => {
    const eth = makeMockEthereum();
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await switchToNetwork(57);

    expect(eth.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x39' }],
    });
  });

  it('calls wallet_switchEthereumChain with correct hex for testnet (5700)', async () => {
    const eth = makeMockEthereum();
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await switchToNetwork(5700);

    expect(eth.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1644' }],
    });
  });

  it('falls back to wallet_addEthereumChain when chain is not yet in wallet (code 4902)', async () => {
    const notAddedError = { code: 4902, message: 'Unrecognized chain ID' };
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockRejectedValueOnce(notAddedError)   // wallet_switchEthereumChain
        .mockResolvedValueOnce(null)             // wallet_addEthereumChain
        .mockResolvedValueOnce(null)             // wallet_switchEthereumChain (retry)
        .mockResolvedValueOnce('0x39'),          // eth_chainId (refresh)
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(57)).resolves.toBeUndefined();

    expect(eth.request).toHaveBeenCalledTimes(4);
    const addCall = eth.request.mock.calls[1][0] as { method: string; params: unknown[] };
    expect(addCall.method).toBe('wallet_addEthereumChain');
    const addParams = addCall.params[0] as { chainId: string; chainName: string; rpcUrls: string[] };
    expect(addParams.chainId).toBe('0x39');
    expect(addParams.chainName).toBe('NEVM Mainnet');
    expect(addParams.rpcUrls).toContain('https://rpc.syscoin.org');
    // Verify switch was retried after add
    const retryCall = eth.request.mock.calls[2][0] as { method: string };
    expect(retryCall.method).toBe('wallet_switchEthereumChain');
  });

  it('includes blockExplorerUrls in wallet_addEthereumChain when explorerUrl is configured', async () => {
    const notAddedError = { code: 4902 };
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockRejectedValueOnce(notAddedError)
        .mockResolvedValueOnce(null)     // wallet_addEthereumChain
        .mockResolvedValueOnce(null)     // wallet_switchEthereumChain (retry)
        .mockResolvedValueOnce('0x39'),  // eth_chainId (refresh)
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await switchToNetwork(57);

    const addParams = (eth.request.mock.calls[1][0] as { params: unknown[] }).params[0] as Record<string, unknown>;
    expect(addParams.blockExplorerUrls).toEqual(['https://explorer.syscoin.org']);
  });

  it('re-throws when user rejects the switch (code 4001)', async () => {
    const userRejected = { code: 4001, message: 'User rejected' };
    const eth = makeMockEthereum({
      request: vi.fn().mockRejectedValueOnce(userRejected),
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(57)).rejects.toMatchObject({ code: 4001 });
    // should NOT call wallet_addEthereumChain
    expect(eth.request).toHaveBeenCalledTimes(1);
  });

  it('re-throws on arbitrary non-4902 errors', async () => {
    const rpcError = { code: -32603, message: 'Internal JSON-RPC error' };
    const eth = makeMockEthereum({
      request: vi.fn().mockRejectedValueOnce(rpcError),
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(57)).rejects.toMatchObject({ code: -32603 });
  });

  it('throws when no ethereum provider is present', async () => {
    Object.defineProperty(window, 'ethereum', { value: undefined, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(57)).rejects.toThrow('No wallet detected');
  });

  it('throws for an unknown chain ID', async () => {
    const eth = makeMockEthereum();
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(999999)).rejects.toThrow('Unknown network: 999999');
    expect(eth.request).not.toHaveBeenCalled();
  });
});

// ── handleChainChanged (via setupWalletListeners) ────────────────────────────

describe('handleChainChanged', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('updates chainId in the store when the chain changes', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();

    // Grab the registered chainChanged handler
    const chainChangedCall = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'chainChanged');
    expect(chainChangedCall).toBeDefined();
    const handler = chainChangedCall![1] as (hex: string) => void;

    handler('0x39'); // 57 decimal

    expect(get(walletStore).chainId).toBe(57);
  });

  it('ignores non-string chainChanged payloads gracefully', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();

    const handler = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'chainChanged')![1] as (v: unknown) => void;

    const before = get(walletStore).chainId;
    handler(null);      // bad payload
    handler(57);        // number instead of hex string
    expect(get(walletStore).chainId).toBe(before); // store unchanged
  });

  it('cleans up event listeners when the returned teardown is called', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    const cleanup = setupWalletListeners();
    cleanup();

    expect(eth.removeListener).toHaveBeenCalledWith('chainChanged', expect.any(Function));
    expect(eth.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
  });
});

// ── connectWallet auto-switch ─────────────────────────────────────────────────

// Shared mock provider factory used across connectWallet tests.
// We mock ~/utils/provider (not ethers directly) since that's what wallet.ts imports.
function setupProviderMock() {
  const mockSigner = { getAddress: vi.fn().mockResolvedValue('0xUserAddress') };
  const mockProvider = {
    send: vi.fn().mockResolvedValue(['0xUserAddress']),
    getSigner: vi.fn().mockResolvedValue(mockSigner),
  };
  vi.doMock('~/utils/provider', () => ({
    createProviderWithoutENS: vi.fn().mockReturnValue(mockProvider),
  }));
  return mockProvider;
}

describe('connectWallet auto-switch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls switchToNetwork(mainnet) when connected on testnet (5700)', async () => {
    setupProviderMock();
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockResolvedValueOnce(['0xUserAddress'])  // eth_requestAccounts
        .mockResolvedValueOnce('0x1644')           // eth_chainId → testnet
        .mockResolvedValueOnce(null)               // wallet_switchEthereumChain
        .mockResolvedValueOnce('0x39'),            // eth_chainId (refresh)
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet } = await import('./wallet');
    await connectWallet();

    const switchCall = eth.request.mock.calls.find(
      (c: unknown[]) => (c[0] as { method: string }).method === 'wallet_switchEthereumChain'
    );
    expect(switchCall).toBeDefined();
    const params = (switchCall![0] as { params: { chainId: string }[] }).params[0];
    expect(params.chainId).toBe('0x39'); // mainnet
  });

  it('does not attempt a switch when already on mainnet (57)', async () => {
    setupProviderMock();
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockResolvedValueOnce(['0xUserAddress'])  // eth_requestAccounts
        .mockResolvedValueOnce('0x39'),            // eth_chainId → mainnet
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet } = await import('./wallet');
    await connectWallet();

    const switchCall = eth.request.mock.calls.find(
      (c: unknown[]) => (c[0] as { method: string }).method === 'wallet_switchEthereumChain'
    );
    expect(switchCall).toBeUndefined();
  });

  it('does not attempt a switch when on hardhat (31337)', async () => {
    setupProviderMock();
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockResolvedValueOnce(['0xUserAddress'])  // eth_requestAccounts
        .mockResolvedValueOnce('0x7a69'),          // eth_chainId → 31337
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet } = await import('./wallet');
    await connectWallet();

    const switchCall = eth.request.mock.calls.find(
      (c: unknown[]) => (c[0] as { method: string }).method === 'wallet_switchEthereumChain'
    );
    expect(switchCall).toBeUndefined();
  });

  it('resolves successfully even if auto-switch is rejected by the user', async () => {
    setupProviderMock();
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockResolvedValueOnce(['0xUserAddress'])               // eth_requestAccounts
        .mockResolvedValueOnce('0x1644')                        // eth_chainId → testnet
        .mockRejectedValueOnce({ code: 4001, message: 'Rejected' }), // switch rejected
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet } = await import('./wallet');
    await expect(connectWallet()).resolves.toBeUndefined();
  });
});

// ── disconnectWallet ──────────────────────────────────────────────────────────

describe('disconnectWallet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clears wallet state and sets userDisconnected', async () => {
    const { disconnectWallet, walletStore } = await import('./wallet');
    disconnectWallet();
    const state = get(walletStore);

    expect(state.provider).toBeNull();
    expect(state.signer).toBeNull();
    expect(state.walletAddress).toBeNull();
    expect(state.chainId).toBeNull();
    expect(state.userDisconnected).toBe(true);
  });

  it('detaches provider event listeners on disconnect', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, disconnectWallet, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();
    disconnectWallet();

    expect(eth.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
    expect(eth.removeListener).toHaveBeenCalledWith('chainChanged', expect.any(Function));
  });
});

// ── connectWallet error path ──────────────────────────────────────────────────

describe('connectWallet error path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('leaves store clean when user rejects eth_requestAccounts', async () => {
    const eth = makeMockEthereum({
      request: vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected the request.' }),
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet, walletStore } = await import('./wallet');
    await expect(connectWallet()).rejects.toMatchObject({ code: 4001 });

    const state = get(walletStore);
    expect(state.walletAddress).toBeNull();
    expect(state.ethereumProvider).toBeNull();
    expect(state.selectedWalletInfo).toBeNull();
    // Listeners are only attached after successful connection — none to detach
    expect(eth.on).not.toHaveBeenCalled();
  });

  it('does not write wallet preference to localStorage on failure', async () => {
    const rabby = makeMockEthereum({
      request: vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected' }),
    });

    const { initWalletDiscovery, connectWallet } = await import('./wallet');
    const cleanup = initWalletDiscovery();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'rabby-uuid', name: 'Rabby Wallet', icon: '', rdns: 'io.rabby' },
        provider: rabby,
      },
    }));

    await expect(connectWallet('rabby-uuid')).rejects.toBeDefined();

    expect(localStorage.getItem('selectedWalletRdns')).toBeNull();
    expect(localStorage.getItem('selectedWalletName')).toBeNull();
    cleanup();
  });
});

// ── handleAccountsChanged ─────────────────────────────────────────────────────

describe('handleAccountsChanged', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('updates walletAddress when account changes', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();

    const handler = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'accountsChanged')![1] as (
      accounts: string[]
    ) => Promise<void>;

    await handler(['0xNewAddress']);

    expect(get(walletStore).walletAddress).toBe('0xNewAddress');
  });

  it('clears walletAddress when accounts become empty (wallet locked)', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();

    const handler = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'accountsChanged')![1] as (
      accounts: string[]
    ) => Promise<void>;

    await handler([]);

    expect(get(walletStore).walletAddress).toBeNull();
    expect(get(walletStore).signer).toBeNull();
  });

  it('ignores malformed account payloads', async () => {
    const eth = makeMockEthereum();

    const { setupWalletListeners, walletStore } = await import('./wallet');
    walletStore.update(s => ({ ...s, ethereumProvider: eth as any }));
    setupWalletListeners();

    const handler = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'accountsChanged')![1] as (
      v: unknown
    ) => Promise<void>;

    // Set a real address first so we can verify it's NOT cleared.
    await handler(['0xRealAddress']);
    expect(get(walletStore).walletAddress).toBe('0xRealAddress');

    await handler(null);
    await handler('not-an-array');
    await handler([42]); // non-string element

    expect(get(walletStore).walletAddress).toBe('0xRealAddress');
  });
});

// ── EIP-6963 multi-wallet ─────────────────────────────────────────────────────

describe('EIP-6963 multi-wallet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shows both wallets when two different providers announce', async () => {
    const eth1 = makeMockEthereum();
    const eth2 = makeMockEthereum();
    const { initWalletDiscovery, walletProvidersStore } = await import('./wallet');
    const cleanup = initWalletDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'mm-uuid', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider: eth1 },
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'rabby-uuid', name: 'Rabby Wallet', icon: '', rdns: 'io.rabby' }, provider: eth2 },
    }));

    const wallets = get(walletProvidersStore);
    expect(wallets).toHaveLength(2);
    expect(wallets.map(w => w.info.rdns)).toContain('io.metamask');
    expect(wallets.map(w => w.info.rdns)).toContain('io.rabby');

    cleanup();
  });

  it('ignores announce events with invalid providers', async () => {
    const { initWalletDiscovery, walletProvidersStore } = await import('./wallet');
    const cleanup = initWalletDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'bad-uuid', name: 'Bad Wallet', icon: '', rdns: 'bad.wallet' }, provider: null },
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'bad2-uuid', name: 'No Request', icon: '', rdns: 'bad2.wallet' }, provider: { on: vi.fn() } },
    }));

    expect(get(walletProvidersStore)).toHaveLength(0);
    cleanup();
  });
});

// ── initWallet ────────────────────────────────────────────────────────────────

describe('initWallet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not attempt auto-connect when userDisconnected flag is set', async () => {
    localStorage.setItem('userDisconnected', 'true');
    const eth = makeMockEthereum();
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { initWallet } = await import('./wallet');
    initWallet();

    // Returns immediately before any async work — no RPC calls made.
    expect(eth.request).not.toHaveBeenCalled();
  });
});
