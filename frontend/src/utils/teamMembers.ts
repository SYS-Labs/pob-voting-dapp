import { Contract, type Provider, type JsonRpcSigner } from 'ethers';
import { CertNFTABI, CertMiddleware_001_ABI } from '~/abis';
import { getCertNFTContract, CERT_NFT_ADDRESSES } from '~/utils/certNFT';
import type { MemberStatus, TeamMember } from '~/interfaces';

function memberStatusFromEnum(status: number): MemberStatus {
  if (status === 0) return 'Proposed';
  if (status === 1) return 'Approved';
  return 'Rejected';
}

export async function getTeamMembers(
  chainId: number,
  iteration: number,
  project: string,
  provider: Provider
): Promise<TeamMember[]> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return [];

  try {
    const members = await certNFT.getTeamMembers(iteration, project);
    return members.map((m: any) => ({
      memberAddress: m.memberAddress,
      status: memberStatusFromEnum(Number(m.status)),
      fullName: m.fullName,
    }));
  } catch {
    return [];
  }
}

export async function getApprovedMemberCount(
  chainId: number,
  iteration: number,
  project: string,
  provider: Provider
): Promise<number> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return 0;

  try {
    const count: bigint = await certNFT.approvedMemberCount(iteration, project);
    return Number(count);
  } catch {
    return 0;
  }
}

export async function proposeTeamMember(
  chainId: number,
  iteration: number,
  member: string,
  signer: JsonRpcSigner
): Promise<any> {
  const certNFT = getCertNFTContract(chainId, signer);
  if (!certNFT) throw new Error('CertNFT contract not available');

  return await certNFT.proposeTeamMember(iteration, member);
}

export async function approveTeamMember(
  chainId: number,
  iteration: number,
  project: string,
  member: string,
  signer: JsonRpcSigner
): Promise<any> {
  const certNFT = getCertNFTContract(chainId, signer);
  if (!certNFT) throw new Error('CertNFT contract not available');

  return await certNFT.approveTeamMember(iteration, project, member);
}

export async function rejectTeamMember(
  chainId: number,
  iteration: number,
  project: string,
  member: string,
  signer: JsonRpcSigner
): Promise<any> {
  const certNFT = getCertNFTContract(chainId, signer);
  if (!certNFT) throw new Error('CertNFT contract not available');

  return await certNFT.rejectTeamMember(iteration, project, member);
}

export async function setTeamMemberName(
  chainId: number,
  iteration: number,
  project: string,
  fullName: string,
  signer: JsonRpcSigner
): Promise<any> {
  const certNFT = getCertNFTContract(chainId, signer);
  if (!certNFT) throw new Error('CertNFT contract not available');

  return await certNFT.setTeamMemberName(iteration, project, fullName);
}

export async function checkIsProject(
  chainId: number,
  iteration: number,
  account: string,
  provider: Provider
): Promise<boolean> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return false;

  try {
    const middlewareAddr: string = await certNFT.middleware(iteration);
    if (middlewareAddr === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    const middleware = new Contract(middlewareAddr, CertMiddleware_001_ABI, provider);
    return await middleware.isProjectInAnyRound(account);
  } catch {
    return false;
  }
}

export async function hasNamedTeamMembers(
  chainId: number,
  iteration: number,
  project: string,
  provider: Provider
): Promise<boolean> {
  const certNFT = getCertNFTContract(chainId, provider);
  if (!certNFT) return false;

  try {
    return await certNFT.hasNamedTeamMembers(iteration, project);
  } catch {
    return false;
  }
}
