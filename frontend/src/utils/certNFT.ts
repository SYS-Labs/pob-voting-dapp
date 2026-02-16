import { Contract, type Provider, type JsonRpcSigner } from 'ethers';
import { CertNFTABI, CertMiddleware_001_ABI } from '~/abis';
import type { Cert, CertEligibility, CertStatus } from '~/interfaces';

const PENDING_PERIOD = 48 * 60 * 60; // 48 hours in seconds

// Per-chain CertNFT proxy addresses.
// Mainnet/testnet addresses are hardcoded here; local dev addresses
// are populated at runtime from the API via mergeCertNFTAddresses().
export const CERT_NFT_ADDRESSES: Record<number, string> = {
  // 57: '0x...', // Mainnet — fill after deploy
  // 5700: '0x...', // Testnet — fill after deploy
};

/**
 * Merge CertNFT addresses discovered from the API into the runtime map.
 * Called by the iterations store after fetching /api/iterations.
 */
export function mergeCertNFTAddresses(addresses: Record<number, string>): void {
  for (const [chainId, address] of Object.entries(addresses)) {
    if (address) {
      CERT_NFT_ADDRESSES[Number(chainId)] = address;
    }
  }
  // Clear the contract cache so stale entries are rebuilt with new addresses
  contractCache.clear();
}

// Contract instance cache
const contractCache = new Map<string, Contract>();

export function getCertNFTContract(chainId: number, signerOrProvider: Provider | JsonRpcSigner): Contract | null {
  const address = CERT_NFT_ADDRESSES[chainId];
  if (!address) return null;

  // Distinguish signer from provider in cache key so write-capable
  // instances are never shadowed by read-only ones.
  const isSigner = 'getAddress' in signerOrProvider;
  const key = `${chainId}-${address}-${isSigner ? 'signer' : 'provider'}`;
  const cached = contractCache.get(key);
  if (cached) return cached;

  const contract = new Contract(address, CertNFTABI, signerOrProvider);
  contractCache.set(key, contract);
  return contract;
}

export async function checkCertEligibility(
  chainId: number,
  iteration: number,
  account: string,
  provider: Provider
): Promise<CertEligibility | null> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return null;

  try {
    const middlewareAddr: string = await certNFT.middleware(iteration);
    if (middlewareAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const middleware = new Contract(middlewareAddr, CertMiddleware_001_ABI, provider);
    const [eligible, certType] = await middleware.validate(account);
    return { eligible, certType };
  } catch {
    return null;
  }
}

export async function getUserCert(
  chainId: number,
  iteration: number,
  account: string,
  provider: Provider
): Promise<Cert | null> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return null;

  try {
    const tokenId: bigint = await certNFT.certOf(account, iteration);
    if (tokenId === 0n) return null;

    const cert = await certNFT.certs(tokenId);
    const statusEnum: bigint = await certNFT.certStatus(tokenId);

    return {
      tokenId: tokenId.toString(),
      iteration: Number(cert.iteration),
      account: cert.account,
      certType: cert.certType,
      status: resolveCertStatusFromEnum(Number(statusEnum)),
      requestTime: Number(cert.requestTime),
    };
  } catch {
    return null;
  }
}

export async function getUserCerts(
  chainId: number,
  account: string,
  iterations: number[],
  provider: Provider
): Promise<Cert[]> {
  const results: Cert[] = [];

  for (const iteration of iterations) {
    const cert = await getUserCert(chainId, iteration, account, provider);
    if (cert) results.push(cert);
  }

  return results;
}

/**
 * Client-side auto-finalize logic matching the contract.
 * Pending + 48h elapsed = Minted; Cancelled always Cancelled.
 */
export function resolveCertStatus(cert: Cert): CertStatus {
  if (cert.status === 'Cancelled') return 'Cancelled';
  if (cert.status === 'Pending') {
    const now = Math.floor(Date.now() / 1000);
    if (now >= cert.requestTime + PENDING_PERIOD) {
      return 'Minted';
    }
  }
  return cert.status;
}

function resolveCertStatusFromEnum(status: number): CertStatus {
  if (status === 0) return 'Pending';
  if (status === 1) return 'Minted';
  return 'Cancelled';
}
