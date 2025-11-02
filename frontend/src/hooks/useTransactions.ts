import { useCallback, useState } from 'react';
import { Contract, JsonRpcSigner, ethers } from 'ethers';
import { JurySC_01ABI, PoB_01ABI } from '~/abis';
import type { Iteration, ParticipantRole } from '~/interfaces';
import { ROLE_LABELS } from '~/constants/roles';
import { MINT_AMOUNTS } from '~/constants/networks';

export function useTransactions(
  signer: JsonRpcSigner | null,
  currentIteration: Iteration | null,
  walletAddress: string | null,
  correctNetwork: boolean,
  chainId: number | null,
) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [txPendingHash, setTxPendingHash] = useState<string | null>(null);
  const [txPendingLabel, setTxPendingLabel] = useState<string>('');
  const [txRefreshCallback, setTxRefreshCallback] = useState<(() => Promise<void>) | null>(null);

  const requireWallet = useCallback(() => {
    if (!walletAddress) {
      throw new Error('Please connect your wallet to continue.');
    }
    if (!correctNetwork) {
      throw new Error('Please switch to Syscoin NEVM (chainId 57 or 5700).');
    }
    return true;
  }, [walletAddress, correctNetwork]);

  const runTransaction = useCallback(
    async (
      label: string,
      action: () => Promise<unknown>,
      onConfirmed?: () => Promise<void>,
    ): Promise<boolean> => {
      try {
        setPendingAction(label);

        // Execute the transaction action and get the response
        const txResponse = await action();

        // Check if response has a hash property (it's a transaction)
        if (txResponse && typeof txResponse === 'object' && 'hash' in txResponse) {
          const hash = (txResponse as { hash: string }).hash;
          setTxPendingHash(hash);
          setTxPendingLabel(label);
          // Store the refresh callback to be called after confirmation
          if (onConfirmed) {
            setTxRefreshCallback(() => onConfirmed);
          }
          // Don't wait for confirmation - modal will handle polling
          return true;
        }

        // If no hash, treat as immediate success (shouldn't happen with transactions)
        return true;
      } catch (txError) {
        console.error('[runTransaction] Error:', txError);

        // Decode common custom errors
        let errorMessage = 'Transaction failed.';
        if (txError instanceof Error) {
          const errorData = (txError as any).data || (txError as any).error?.data?.data;

          // Map of error signatures to user-friendly messages
          const errorMap: Record<string, string> = {
            '0x380fcdc1': 'Cannot activate: You must set a DevRel account and add at least 1 DAO_HIC voter first.',
            '0xbe8aa6fc': 'Invalid project: Project is not registered.',
            '0xef65161f': 'Contract is already activated.',
            '0xfbf2f40f': 'Projects are locked and cannot be modified.',
            '0x6f5ffb7e': 'Contract is locked for history.',
            '0x7c9a1cf9': 'You have already voted.',
            '0x6470d829': 'You are not the DevRel account.',
            '0x4fe1ec77': 'You are not a DAO_HIC voter.',
            '0x80cb55e2': 'Voting is not active yet.',
            '0xdcc08b25': 'Projects cannot vote.',
            '0x0f3e2a3e': 'Invalid NFT: You do not own this token.',
          };

          // Check if error data contains a known error signature
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
        setPendingAction(null);
      }
    },
    [],
  );

  const executeMint = useCallback(
    async (role: ParticipantRole, refreshCallback?: () => Promise<void>) => {
      if (!requireWallet() || !signer || !currentIteration) return;
      const contract = new Contract(currentIteration?.pob, PoB_01ABI, signer);

      let tx: () => Promise<unknown>;
      let label: string;

      // Get network-specific mint amount
      const mintAmount = chainId ? MINT_AMOUNTS[chainId] ?? '30' : '30';

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
          label = 'Mint DAO_HIC Badge';
          break;
        case 'project':
          tx = () => contract.mintProject();
          label = 'Mint Project Badge';
          break;
        default:
          return;
      }

      await runTransaction(label, tx, refreshCallback);
    },
    [requireWallet, signer, currentIteration, chainId, runTransaction],
  );

  const executeVote = useCallback(
    async (role: ParticipantRole, projectAddress: string, tokenId?: string, refreshCallback?: () => Promise<void>) => {
      if (!requireWallet() || !signer || !currentIteration) return;
      const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
      const label = `Vote as ${ROLE_LABELS[role]}`;

      console.log('[executeVote]', { role, projectAddress, tokenId, jurySC: currentIteration.jurySC });

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
    },
    [requireWallet, signer, currentIteration, runTransaction],
  );

  const executeClaim = useCallback(
    async (tokenId: string) => {
      if (!requireWallet() || !signer || !currentIteration) return;
      const contract = new Contract(currentIteration?.pob, PoB_01ABI, signer);
      return {
        label: `Claim deposit for token ${tokenId}`,
        tx: () => contract.claim(tokenId)
      };
    },
    [requireWallet, signer, currentIteration],
  );

  const clearTxPending = useCallback(() => {
    setTxPendingHash(null);
    setTxPendingLabel('');
  }, []);

  return {
    pendingAction,
    txPendingHash,
    txPendingLabel,
    txRefreshCallback,
    setTxRefreshCallback,
    clearTxPending,
    runTransaction,
    executeMint,
    executeVote,
    executeClaim,
  };
}
