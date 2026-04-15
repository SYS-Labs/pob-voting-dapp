import type { Provider } from 'ethers';
import type { IterationMetadata } from '~/interfaces';
import { metadataAPI } from './metadata-api';
import { getIterationMetadataCID } from './registry';

export async function getIterationMetadataByCID(cid: string): Promise<IterationMetadata | null> {
  try {
    const metadataMap = await metadataAPI.batchGetByCIDs([cid]);
    return (metadataMap[cid] as IterationMetadata | undefined) ?? null;
  } catch (error) {
    console.warn('[iterationMetadata] Failed to fetch iteration metadata by CID', { cid, error });
    return null;
  }
}

export async function getResolvedIterationMetadata(
  chainId: number,
  contractAddress: string,
  provider?: Provider | null
): Promise<IterationMetadata | null> {
  if (provider) {
    const cid = await getIterationMetadataCID(chainId, contractAddress, provider);
    if (cid) {
      const metadata = await getIterationMetadataByCID(cid);
      if (metadata) return metadata;
    }
  }

  return metadataAPI.getIterationMetadata(chainId, contractAddress);
}
