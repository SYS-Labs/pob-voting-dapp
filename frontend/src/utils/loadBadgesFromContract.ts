import { Contract, ethers, Interface, JsonRpcProvider } from 'ethers';
import type { ParticipantRole } from '~/interfaces';
import { PoB_01ABI } from '~/abis';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';

export interface Badge {
  tokenId: string;
  role: ParticipantRole;
  claimed: boolean;
  iteration: number;
  round?: number;
}

/**
 * Load badges from a specific PoB contract for a given wallet address
 * Reusable function for both current iteration and previous rounds
 */
export async function loadBadgesFromContract(
  pobAddress: string,
  chainId: number,
  walletAddress: string,
  publicProvider: JsonRpcProvider,
  deployBlockHint?: number,
  round?: number,
): Promise<Badge[]> {
  const badges: Badge[] = [];

  try {
    const pobContract = new Contract(pobAddress, PoB_01ABI, publicProvider);
    const iface = new Interface(PoB_01ABI);
    const transferTopic = iface.getEvent('Transfer')?.topicHash;

    if (!transferTopic) {
      console.warn('[loadBadgesFromContract] No Transfer event topic found');
      return badges;
    }

    const fromBlock = deployBlockHint !== undefined ? deployBlockHint : 0;
    const [logs, iterationValue] = await Promise.all([
      publicProvider.getLogs({
        address: pobAddress,
        fromBlock,
        toBlock: 'latest',
        topics: [transferTopic, null, ethers.zeroPadValue(walletAddress, 32)],
      }),
      pobContract.iteration(),
    ]);

    const iterationNumber = Number(iterationValue);
    console.log(`[loadBadgesFromContract] Found ${logs?.length || 0} transfer logs for ${pobAddress}`);

    if (!logs?.length) return badges;

    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const tokenId = parsed.args?.tokenId?.toString();
        if (!tokenId) continue;

        const [owner, role, claimed] = await cachedPromiseAll(publicProvider, chainId, [
          { key: `ownerOf:${pobAddress}:${tokenId}`, promise: pobContract.ownerOf(tokenId) },
          { key: `roleOf:${pobAddress}:${tokenId}`, promise: pobContract.roleOf(tokenId) },
          { key: `claimed:${pobAddress}:${tokenId}`, promise: pobContract.claimed(tokenId) },
        ]);

        if (owner.toLowerCase() === walletAddress.toLowerCase()) {
          badges.push({
            tokenId,
            role: role.toLowerCase() as ParticipantRole,
            claimed,
            iteration: iterationNumber,
            round,
          });
        }
      } catch (parseError) {
        console.warn('[loadBadgesFromContract] Failed to parse badge log', parseError);
      }
    }
  } catch (error) {
    console.warn(`[loadBadgesFromContract] Failed to load badges from ${pobAddress}`, error);
  }

  return badges;
}
