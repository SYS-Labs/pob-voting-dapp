import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMockEthereum(overrides: Partial<{
  request: (...args: unknown[]) => Promise<unknown>;
  on: (...args: unknown[]) => void;
  removeListener: (...args: unknown[]) => void;
}> = {}) {
  return {
    request: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

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
        .mockRejectedValueOnce(notAddedError)   // first call: wallet_switchEthereumChain
        .mockResolvedValueOnce(null),            // second call: wallet_addEthereumChain
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { switchToNetwork } = await import('./wallet');
    await expect(switchToNetwork(57)).resolves.toBeUndefined();

    expect(eth.request).toHaveBeenCalledTimes(2);
    const addCall = eth.request.mock.calls[1][0] as { method: string; params: unknown[] };
    expect(addCall.method).toBe('wallet_addEthereumChain');
    const addParams = addCall.params[0] as { chainId: string; chainName: string; rpcUrls: string[] };
    expect(addParams.chainId).toBe('0x39');
    expect(addParams.chainName).toBe('NEVM Mainnet');
    expect(addParams.rpcUrls).toContain('https://rpc.syscoin.org');
  });

  it('includes blockExplorerUrls in wallet_addEthereumChain when explorerUrl is configured', async () => {
    const notAddedError = { code: 4902 };
    const eth = makeMockEthereum({
      request: vi.fn()
        .mockRejectedValueOnce(notAddedError)
        .mockResolvedValueOnce(null),
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
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { setupWalletListeners, walletStore } = await import('./wallet');
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
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { setupWalletListeners, walletStore } = await import('./wallet');
    setupWalletListeners();

    const handler = eth.on.mock.calls.find((c: unknown[]) => c[0] === 'chainChanged')![1] as (v: unknown) => void;

    const before = get(walletStore).chainId;
    handler(null);      // bad payload
    handler(57);        // number instead of hex string
    expect(get(walletStore).chainId).toBe(before); // store unchanged
  });

  it('cleans up event listeners when the returned teardown is called', async () => {
    const eth = makeMockEthereum();
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { setupWalletListeners } = await import('./wallet');
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
        .mockResolvedValueOnce('0x1644')  // eth_chainId → testnet
        .mockResolvedValueOnce(null),     // wallet_switchEthereumChain succeeds
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
      request: vi.fn().mockResolvedValue('0x39'), // eth_chainId → mainnet
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
      request: vi.fn().mockResolvedValue('0x7a69'), // eth_chainId → 31337
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
        .mockResolvedValueOnce('0x1644')                              // eth_chainId → testnet
        .mockRejectedValueOnce({ code: 4001, message: 'Rejected' }), // switch rejected
    });
    Object.defineProperty(window, 'ethereum', { value: eth, writable: true, configurable: true });

    const { connectWallet } = await import('./wallet');
    // rejection is swallowed — modal will offer manual switch
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
});
