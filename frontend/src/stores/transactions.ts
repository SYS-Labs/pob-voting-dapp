import { writable, derived, get } from 'svelte/store';
import { ethers } from 'ethers';
import type { Iteration, ParticipantRole } from '~/interfaces';
import { ROLE_LABELS } from '~/constants/roles';
import { NETWORKS } from '~/constants/networks';
import { getTransactionContext } from './registry';
import { createWriteDispatcher } from '~/utils/writeDispatch';

// ============================================================================
// Types
// ============================================================================

interface TransactionsState {
  pendingAction: string | null;
  txPendingHash: string | null;
  txPendingLabel: string;
  txRefreshCallback: (() => Promise<void>) | null;
}

// ============================================================================
// Store
// ============================================================================

const initialState: TransactionsState = {
  pendingAction: null,
  txPendingHash: null,
  txPendingLabel: '',
  txRefreshCallback: null,
};

export const transactionsStore = writable<TransactionsState>(initialState);

// Derived stores
export const pendingAction = derived(transactionsStore, $t => $t.pendingAction);
export const txPendingHash = derived(transactionsStore, $t => $t.txPendingHash);
export const txPendingLabel = derived(transactionsStore, $t => $t.txPendingLabel);
export const txRefreshCallback = derived(transactionsStore, $t => $t.txRefreshCallback);

// ============================================================================
// Actions
// ============================================================================

export function clearTxPending(): void {
  transactionsStore.update(s => ({
    ...s,
    txPendingHash: null,
    txPendingLabel: '',
    pendingAction: null,
  }));
}

export function setTxRefreshCallback(callback: (() => Promise<void>) | null): void {
  transactionsStore.update(s => ({ ...s, txRefreshCallback: callback }));
}

function requireWallet(
  walletAddress: string | null,
  correctNetwork: boolean
): boolean {
  if (!walletAddress) {
    throw new Error('Please connect your wallet to continue.');
  }
  if (!correctNetwork) {
    throw new Error('Please switch to a supported network (Syscoin NEVM).');
  }
  return true;
}

export async function runTransaction(
  label: string,
  action: () => Promise<unknown>,
  onConfirmed?: () => Promise<void>
): Promise<boolean> {
  try {
    transactionsStore.update(s => ({ ...s, pendingAction: label }));

    const txResponse = await action();

    if (txResponse && typeof txResponse === 'object' && 'hash' in txResponse) {
      const hash = (txResponse as { hash: string }).hash;
      transactionsStore.update(s => ({
        ...s,
        txPendingHash: hash,
        txPendingLabel: label,
        txRefreshCallback: onConfirmed || null,
      }));
      return true;
    }

    return true;
  } catch (txError) {
    console.error('[runTransaction] Error:', txError);

    let errorMessage = 'Transaction failed.';
    if (txError instanceof Error) {
      const errorData = (txError as any).data || (txError as any).error?.data?.data;

      const errorMap: Record<string, string> = {
        '0x380fcdc1': 'Cannot activate: You must set an SMT voter and add at least 1 DAO HIC voter first.',
        '0xbe8aa6fc': 'Invalid project: Project is not registered.',
        '0xef65161f': 'Contract is already activated.',
        '0xfbf2f40f': 'Projects are locked and cannot be modified.',
        '0x6f5ffb7e': 'Contract is locked for history.',
        '0x7c9a1cf9': 'You have already voted.',
        '0x6470d829': 'You are not an SMT voter.',
        '0x4fe1ec77': 'You are not a DAO HIC voter.',
        '0x80cb55e2': 'Voting is not active yet.',
        '0xdcc08b25': 'Projects cannot vote.',
        '0x0f3e2a3e': 'Invalid NFT: You do not own this token.',
        // SMT v003 errors
        '0x2e4c697e': 'You are not an SMT voter.',
      };

      if (typeof errorData === 'string') {
        const sig = errorData.slice(0, 10);
        if (errorMap[sig]) {
          errorMessage = errorMap[sig];
        } else {
          errorMessage = txError.message;
        }
      } else {
        errorMessage = txError.message;
      }
    }

    throw new Error(errorMessage);
  } finally {
    transactionsStore.update(s => ({ ...s, pendingAction: null }));
  }
}

export async function executeMint(
  role: ParticipantRole,
  refreshCallback?: () => Promise<void>
): Promise<void> {
  const ctx = getTransactionContext();
  requireWallet(ctx.walletAddress, ctx.correctNetwork);
  if (!ctx.signer || !ctx.selectedIteration) return;

  const writer = createWriteDispatcher(ctx.selectedIteration, ctx.signer);

  let tx: () => Promise<unknown>;
  let label: string;

  const network = ctx.chainId ? NETWORKS[ctx.chainId] : null;
  const mintAmount = network?.mintAmount ?? '30';

  switch (role) {
    case 'community':
      tx = () => writer.mintCommunity(ethers.parseEther(mintAmount));
      label = 'Mint Community Badge';
      break;
    case 'smt':
      tx = () => writer.mintSmt();
      label = 'Mint SMT Badge';
      break;
    case 'dao_hic':
      tx = () => writer.mintDaoHic();
      label = 'Mint DAO HIC Badge';
      break;
    case 'project':
      tx = () => writer.mintProject();
      label = 'Mint Project Badge';
      break;
    default:
      return;
  }

  await runTransaction(label, tx, refreshCallback);
}

export async function executeVote(
  role: ParticipantRole,
  projectAddress: string,
  tokenId?: string,
  refreshCallback?: () => Promise<void>
): Promise<void> {
  const ctx = getTransactionContext();
  requireWallet(ctx.walletAddress, ctx.correctNetwork);
  if (!ctx.signer || !ctx.selectedIteration) return;

  const writer = createWriteDispatcher(ctx.selectedIteration, ctx.signer);
  const label = `Vote as ${ROLE_LABELS[role]}`;

  console.log('[executeVote]', { role, projectAddress, tokenId, jurySC: ctx.selectedIteration.jurySC });

  const tx = async () => {
    if (role === 'community' && tokenId) {
      console.log('[executeVote] Calling voteCommunity:', tokenId, projectAddress);
      return writer.voteCommunity(tokenId, projectAddress);
    }
    if (role === 'smt') {
      console.log('[executeVote] Calling voteSmt:', projectAddress);
      return writer.voteSmt(projectAddress);
    }
    if (role === 'dao_hic') {
      console.log('[executeVote] Calling voteDaoHic:', projectAddress);
      return writer.voteDaoHic(projectAddress);
    }
    throw new Error('Unsupported voting role');
  };

  await runTransaction(label, tx, refreshCallback);
}

export async function executeClaim(
  tokenId: string
): Promise<{ label: string; tx: () => Promise<unknown> } | undefined> {
  const ctx = getTransactionContext();
  requireWallet(ctx.walletAddress, ctx.correctNetwork);
  if (!ctx.signer || !ctx.selectedIteration) return;

  const writer = createWriteDispatcher(ctx.selectedIteration, ctx.signer);
  return {
    label: `Claim deposit for token ${tokenId}`,
    tx: () => writer.claim(tokenId)
  };
}

export async function setVotingModeAction(
  mode: number,
  refreshCallback?: () => Promise<void>
): Promise<void> {
  const ctx = getTransactionContext();
  requireWallet(ctx.walletAddress, ctx.correctNetwork);
  if (!ctx.signer || !ctx.selectedIteration) return;

  const writer = createWriteDispatcher(ctx.selectedIteration, ctx.signer);
  const modeName = mode === 0 ? 'Consensus' : 'Weighted';

  await runTransaction(
    `Change voting mode to ${modeName}`,
    () => writer.setVotingMode(mode),
    refreshCallback
  );
}
