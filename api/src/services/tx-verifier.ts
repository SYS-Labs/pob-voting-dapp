import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { NETWORKS, getRpcUrl } from '../constants/networks.js';

// PoBRegistry ABI for authorization checks
const REGISTRY_ABI = [
  'function owner() external view returns (address)',
  'function initializationComplete() external view returns (bool)',
  'function setProjectMetadata(uint256 chainId, address jurySC, address project, string calldata cid) external',
  'function setIterationMetadata(uint256 chainId, address jurySC, string calldata cid) external'
];

// JurySC ABI for project validation and lock status
const JURYSC_ABI = [
  'function isRegisteredProject(address project) external view returns (bool)',
  'function projectsLocked() external view returns (bool)',
  'function locked() external view returns (bool)'
];

export interface DecodedMetadataTx {
  signer: string;
  txHash: string;
  to: string;
  chainId: number;
  jurySC: string;
  projectAddress: string | null;
  cid: string;
  kind: 'project' | 'iteration';
}

/**
 * Parse and verify a raw signed transaction for metadata upload
 */
export async function verifyMetadataTx(
  rawTx: string,
  expectedChainId: number,
  expectedCID: string
): Promise<DecodedMetadataTx> {
  try {
    // Parse the raw transaction
    const tx = ethers.Transaction.from(rawTx);

    // Verify chain ID
    if (tx.chainId !== BigInt(expectedChainId)) {
      throw new Error(`Chain ID mismatch: expected ${expectedChainId}, got ${tx.chainId}`);
    }

    // Get signer from transaction
    const signer = tx.from;
    if (!signer) {
      throw new Error('Unable to recover signer from transaction');
    }

    // Compute tx hash
    const txHash = tx.hash;
    if (!txHash) {
      throw new Error('Unable to compute transaction hash');
    }

    // Verify transaction is to the correct registry
    const registryAddress = NETWORKS[expectedChainId]?.registryAddress;
    if (!registryAddress || registryAddress === '') {
      throw new Error(`No PoBRegistry address configured for chain ${expectedChainId}`);
    }

    if (tx.to?.toLowerCase() !== registryAddress.toLowerCase()) {
      throw new Error(`Transaction not sent to PoBRegistry: ${tx.to} != ${registryAddress}`);
    }

    // Decode the calldata
    const iface = new ethers.Interface(REGISTRY_ABI);

    if (!tx.data) {
      throw new Error('Transaction has no calldata');
    }

    const decoded = iface.parseTransaction({ data: tx.data });
    if (!decoded) {
      throw new Error('Unable to decode transaction calldata');
    }

    // Determine if this is project or iteration metadata
    let jurySC: string;
    let projectAddress: string | null = null;
    let cid: string;
    let kind: 'project' | 'iteration';

    if (decoded.name === 'setProjectMetadata') {
      // setProjectMetadata(uint256 chainId, address jurySC, address project, string cid)
      const decodedChainId = Number(decoded.args[0]);
      jurySC = decoded.args[1] as string;
      projectAddress = decoded.args[2] as string;
      cid = decoded.args[3] as string;
      kind = 'project';

      // Verify chainId in calldata matches
      if (decodedChainId !== expectedChainId) {
        throw new Error(`ChainId in calldata (${decodedChainId}) != tx chainId (${expectedChainId})`);
      }
    } else if (decoded.name === 'setIterationMetadata') {
      // setIterationMetadata(uint256 chainId, address jurySC, string cid)
      const decodedChainId = Number(decoded.args[0]);
      jurySC = decoded.args[1] as string;
      cid = decoded.args[2] as string;
      kind = 'iteration';

      // Verify chainId in calldata matches
      if (decodedChainId !== expectedChainId) {
        throw new Error(`ChainId in calldata (${decodedChainId}) != tx chainId (${expectedChainId})`);
      }
    } else {
      throw new Error(`Unknown function: ${decoded.name}`);
    }

    // Verify CID matches expected
    if (cid !== expectedCID) {
      throw new Error(`CID mismatch: expected ${expectedCID}, got ${cid}`);
    }

    logger.info('Decoded metadata transaction', {
      signer,
      txHash,
      chainId: expectedChainId,
      jurySC,
      projectAddress,
      cid,
      kind
    });

    return {
      signer,
      txHash,
      to: tx.to!,
      chainId: expectedChainId,
      jurySC,
      projectAddress,
      cid,
      kind
    };
  } catch (error) {
    logger.error('Failed to verify metadata transaction', { error, rawTx });
    throw error;
  }
}

/**
 * Check if signer is authorized to upload metadata
 */
export async function checkAuthorization(
  decoded: DecodedMetadataTx
): Promise<boolean> {
  const { signer, chainId, jurySC, projectAddress, kind } = decoded;

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chain ${chainId}`);
  }

  const registryAddress = NETWORKS[chainId]?.registryAddress;
  if (!registryAddress || registryAddress === '') {
    throw new Error(`No PoBRegistry address configured for chain ${chainId}`);
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);

    if (kind === 'project') {
      if (!projectAddress) {
        throw new Error('Project address required for project metadata');
      }

      // Check 1: signer must be the project address
      if (signer.toLowerCase() !== projectAddress.toLowerCase()) {
        logger.warn('Authorization failed: signer != project address', {
          signer,
          projectAddress
        });
        return false;
      }

      // Check 2: project must be registered in JurySC
      const juryContract = new ethers.Contract(jurySC, JURYSC_ABI, provider);
      const isRegistered = await juryContract.isRegisteredProject(projectAddress);

      if (!isRegistered) {
        logger.warn('Authorization failed: project not registered in JurySC', {
          chainId,
          jurySC,
          projectAddress
        });
        return false;
      }

      // Check 3: metadata editing window must still be open
      const projectsLocked = await juryContract.projectsLocked();

      if (projectsLocked) {
        logger.warn('Authorization failed: metadata editing closed (voting started)', {
          chainId,
          jurySC,
          projectAddress
        });
        return false;
      }

      logger.info('Project authorized', { signer, projectAddress, chainId, jurySC });
      return true;

    } else {
      // Iteration metadata - only owner can upload
      const owner = await registry.owner();

      if (signer.toLowerCase() !== owner.toLowerCase()) {
        logger.warn('Authorization failed: signer is not registry owner', {
          signer,
          owner
        });
        return false;
      }

      // After initialization: check if JurySC is locked for history
      const initComplete = await registry.initializationComplete();

      if (initComplete) {
        const juryContract = new ethers.Contract(jurySC, JURYSC_ABI, provider);
        const isLocked = await juryContract.locked();

        if (isLocked) {
          logger.warn('Authorization failed: iteration locked for history', {
            chainId,
            jurySC
          });
          return false;
        }
      }
      // During initialization: no lock check (allows importing historical data)

      logger.info('Owner authorized for iteration metadata', { signer, chainId, jurySC });
      return true;
    }
  } catch (error) {
    logger.error('Failed to check authorization', { error, decoded });
    throw error;
  }
}
