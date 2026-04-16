import { get } from 'svelte/store';
import type { JsonRpcProvider, JsonRpcSigner } from 'ethers';
import { walletStore, getPublicProviderForChain } from './wallet';
import { currentIteration, usableIterations } from './iterations';
import type { Iteration } from '~/interfaces';
import { SYS_COIN_ID, SYS_TESTNET_ID, HARDHAT_ID } from '~/constants/networks';

export interface TransactionContext {
  signer: JsonRpcSigner | null;
  walletAddress: string | null;
  chainId: number | null;
  targetChainId: number | null;
  correctNetwork: boolean;
  selectedIteration: Iteration | null;
  publicProvider: JsonRpcProvider | null;
  allIterations: Iteration[];
}

/**
 * Gets the current transaction context from stores.
 * Use this in action functions to avoid passing many parameters.
 */
export function getTransactionContext(): TransactionContext {
  const wallet = get(walletStore);
  const iteration = get(currentIteration);
  const targetChainId = iteration?.chainId ?? null;
  const supportedWalletChain =
    wallet.chainId === null ||
    wallet.chainId === SYS_COIN_ID ||
    wallet.chainId === SYS_TESTNET_ID ||
    wallet.chainId === HARDHAT_ID;

  return {
    signer: wallet.signer,
    walletAddress: wallet.walletAddress,
    chainId: wallet.chainId,
    targetChainId,
    correctNetwork: targetChainId !== null ? wallet.chainId === targetChainId : supportedWalletChain,
    selectedIteration: iteration,
    publicProvider: targetChainId ? getPublicProviderForChain(targetChainId) : null,
    allIterations: get(usableIterations),
  };
}
