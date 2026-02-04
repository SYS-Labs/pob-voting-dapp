import { writable, derived, get } from 'svelte/store';
import { Contract, ethers, type JsonRpcProvider } from 'ethers';
import { JurySC_01ABI, PoB_01ABI, PoB_02ABI } from '~/abis';
import type { Iteration, ParticipantRole } from '~/interfaces';
import { ROLE_LABELS } from '~/constants/roles';
import { NETWORKS } from '~/constants/networks';
import { getTransactionContext } from './registry';

// ============================================================================
// Types
// ============================================================================

interface TransactionsState {
  pendingAction: string | null;
  txPendingHash: string | null;
  txPendingLabel: string;
  txRefreshCallback: (() => Promise<void>) | null;
}

// Helper to select PoB ABI based on version
function getPoBContractABI(version: string | undefined) {
  if (version === '001' || version === '002') return PoB_01ABI;
  return PoB_02ABI;
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

async function validateVotingState(
  currentIteration: Iteration | null,
  publicProvider: JsonRpcProvider | null,
  requireActive = true
): Promise<{ isActive: boolean; votingEnded: boolean }> {
  if (!currentIteration || !publicProvider) {
    throw new Error('Cannot validate: missing iteration or provider');
  }

  const jurySC = new Contract(currentIteration.jurySC, JurySC_01ABI, publicProvider);
  const [isActive, votingEnded] = await Promise.all([
    jurySC.isActive(),
    jurySC.votingEnded()
  ]);

  if (requireActive && !isActive) {
    throw new Error('Voting is not active. Please refresh the page.');
  }
  if (requireActive && votingEnded) {
    throw new Error('Voting has ended. Please refresh the page.');
  }

  return { isActive, votingEnded };
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
        '0x380fcdc1': 'Cannot activate: You must set a DevRel account and add at least 1 DAO HIC voter first.',
        '0xbe8aa6fc': 'Invalid project: Project is not registered.',
        '0xef65161f': 'Contract is already activated.',
        '0xfbf2f40f': 'Projects are locked and cannot be modified.',
        '0x6f5ffb7e': 'Contract is locked for history.',
        '0x7c9a1cf9': 'You have already voted.',
        '0x6470d829': 'You are not the DevRel account.',
        '0x4fe1ec77': 'You are not a DAO HIC voter.',
        '0x80cb55e2': 'Voting is not active yet.',
        '0xdcc08b25': 'Projects cannot vote.',
        '0x0f3e2a3e': 'Invalid NFT: You do not own this token.',
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

  if (role === 'community') {
    await validateVotingState(ctx.selectedIteration, ctx.publicProvider, true);
  } else {
    const { votingEnded } = await validateVotingState(ctx.selectedIteration, ctx.publicProvider, false);
    if (!votingEnded) {
      throw new Error('You can only mint this badge after voting has ended.');
    }
  }

  const pobABI = getPoBContractABI(ctx.selectedIteration.version);
  const contract = new Contract(ctx.selectedIteration.pob, pobABI, ctx.signer);

  let tx: () => Promise<unknown>;
  let label: string;

  const network = ctx.chainId ? NETWORKS[ctx.chainId] : null;
  const mintAmount = network?.mintAmount ?? '30';

  switch (role) {
    case 'community':
      tx = () => contract.mint({ value: ethers.parseEther(mintAmount) });
      label = 'Mint Community Badge';
      break;
    case 'devrel':
      tx = () => contract.mintDevRel();
      label = 'Mint DevRel Badge';
      break;
    case 'dao_hic':
      tx = () => contract.mintDaoHic();
      label = 'Mint DAO HIC Badge';
      break;
    case 'project':
      tx = () => contract.mintProject();
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

  await validateVotingState(ctx.selectedIteration, ctx.publicProvider, true);

  const contract = new Contract(ctx.selectedIteration.jurySC, JurySC_01ABI, ctx.signer);
  const label = `Vote as ${ROLE_LABELS[role]}`;

  console.log('[executeVote]', { role, projectAddress, tokenId, jurySC: ctx.selectedIteration.jurySC });

  const tx = async () => {
    if (role === 'community' && tokenId) {
      console.log('[executeVote] Calling voteCommunity:', tokenId, projectAddress);
      return contract.voteCommunity(tokenId, projectAddress);
    }
    if (role === 'devrel') {
      console.log('[executeVote] Calling voteDevRel:', projectAddress);
      return contract.voteDevRel(projectAddress);
    }
    if (role === 'dao_hic') {
      console.log('[executeVote] Calling voteDaoHic:', projectAddress);
      return contract.voteDaoHic(projectAddress);
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

  const contract = new Contract(ctx.selectedIteration.pob, PoB_01ABI, ctx.signer);
  return {
    label: `Claim deposit for token ${tokenId}`,
    tx: () => contract.claim(tokenId)
  };
}

export async function setVotingModeAction(
  mode: number,
  refreshCallback?: () => Promise<void>
): Promise<void> {
  const ctx = getTransactionContext();
  requireWallet(ctx.walletAddress, ctx.correctNetwork);
  if (!ctx.signer || !ctx.selectedIteration) return;

  const contract = new Contract(ctx.selectedIteration.jurySC, JurySC_01ABI, ctx.signer);
  const modeName = mode === 0 ? 'Consensus' : 'Weighted';

  await runTransaction(
    `Change voting mode to ${modeName}`,
    () => contract.setVotingMode(mode),
    refreshCallback
  );
}
