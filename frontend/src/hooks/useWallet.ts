import { useCallback, useEffect, useState } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS } from '~/utils/provider';

export function useWallet(resetState: () => void) {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [userDisconnected, setUserDisconnected] = useState<boolean>(() => {
    return localStorage.getItem('userDisconnected') === 'true';
  });

  const handleAccountsChanged = useCallback(
    (accounts: unknown) => {
      if (!Array.isArray(accounts) || accounts.some((acct) => typeof acct !== 'string')) {
        console.warn('[handleAccountsChanged] Received unexpected payload:', accounts);
        setWalletAddress(null);
        setSigner(null);
        resetState();
        return;
      }
      if (!accounts.length) {
        setWalletAddress(null);
        setSigner(null);
        resetState();
        return;
      }
      const [primaryAccount] = accounts as string[];
      // If accounts changed (user switched), clear the disconnect flag
      setUserDisconnected(false);
      localStorage.setItem('userDisconnected', 'false');
      setWalletAddress(primaryAccount);
      if (provider) {
        provider.getSigner().then((nextSigner) => setSigner(nextSigner));
      }
    },
    [provider, resetState],
  );

  const handleChainChanged = useCallback((hexChainId: unknown) => {
    if (typeof hexChainId !== 'string') {
      console.warn('[handleChainChanged] Received unexpected payload:', hexChainId);
      return;
    }
    const numericChainId = Number.parseInt(hexChainId, 16);
    setChainId(numericChainId);
    resetState();
  }, [resetState]);

  const connectWallet = useCallback(async () => {
    console.log('[connectWallet] Starting wallet connection...');
    const ethereum = window.ethereum;
    if (!ethereum) {
      console.error('[connectWallet] No ethereum provider found');
      throw new Error('No injected wallet detected. Please install a Web3 wallet.');
    }
    try {
      setUserDisconnected(false);
      localStorage.setItem('userDisconnected', 'false');
      const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
      const numericChainId = Number.parseInt(hexChainId, 16);
      console.log('[connectWallet] Chain ID:', numericChainId);
      const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
      const accounts = await nextProvider.send('eth_requestAccounts', []);
      console.log('[connectWallet] Connected to account:', accounts[0]);
      setProvider(nextProvider);
      setChainId(numericChainId);
      setWalletAddress(accounts[0]);
      // Get signer
      const nextSigner = await nextProvider.getSigner();
      setSigner(nextSigner);
      console.log('[connectWallet] Connection complete');
    } catch (walletError) {
      console.error('[connectWallet] Error:', walletError);
      throw walletError;
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    console.log('[disconnectWallet] Disconnecting...');
    setUserDisconnected(true);
    localStorage.setItem('userDisconnected', 'true');
    setWalletAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    resetState();
    console.log('[disconnectWallet] Disconnected. State cleared.');
  }, [resetState]);

  // Auto-connect on mount if user has previously connected
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum || userDisconnected) return;

    let cancelled = false;

    void (async () => {
      console.log('[Auto-connect] Checking for existing accounts...');
      try {
        const accounts = await ethereum.request<string[]>({ method: 'eth_accounts' });
        if (!accounts || !accounts.length) {
          console.log('[Auto-connect] No accounts found');
          return;
        }
        if (cancelled) return;

        console.log('[Auto-connect] Found account, restoring connection...');
        const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
        const numericChainId = Number.parseInt(hexChainId, 16);
        const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
        const nextSigner = await nextProvider.getSigner();

        if (cancelled) return;

        setProvider(nextProvider);
        setChainId(numericChainId);
        setWalletAddress(accounts[0]);
        setSigner(nextSigner);
        console.log('[Auto-connect] Restored connection');
      } catch (autoConnectError) {
        if (!cancelled) {
          console.log('[Auto-connect] Failed silently', autoConnectError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userDisconnected]);

  // Set up event listeners separately, only when we have a provider
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum || !provider) return;

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
  }, [provider, handleAccountsChanged, handleChainChanged]);

  return {
    provider,
    signer,
    walletAddress,
    chainId,
    connectWallet,
    disconnectWallet,
  };
}
