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
  const chainId = iteration?.chainId ?? null;

  return {
    signer: wallet.signer,
    walletAddress: wallet.walletAddress,
    chainId: wallet.chainId,
    correctNetwork: [SYS_COIN_ID, SYS_TESTNET_ID, HARDHAT_ID, null].includes(wallet.chainId),
    selectedIteration: iteration,
    publicProvider: chainId ? getPublicProviderForChain(chainId) : null,
    allIterations: get(usableIterations),
  };
}
