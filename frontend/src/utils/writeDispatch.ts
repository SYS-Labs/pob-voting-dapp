/**
 * Write Dispatcher — First-class object for version-aware write operations.
 *
 * Callers say *what* they want (writer.voteSmt(project)), the dispatcher
 * handles *how* (version-specific function name, correct contract, ABI).
 *
 * Entity 0 = SMT (v003) / DevRel (v001/v002)
 * Entity 1 = DAO_HIC (same across all versions)
 */

import { Contract, type Signer, type ContractTransactionResponse } from 'ethers';
import { JurySCWriteAllABI, PoBWriteAllABI } from '~/abis';

// ---------------------------------------------------------------------------
// Version-specific function name mappings (private)
// ---------------------------------------------------------------------------

const WRITE_MAP: Record<string, Record<string, string>> = {
  // Voting
  voteSmt:       { '001': 'voteDevRel', '002': 'voteDevRel', '003': 'voteSmt' },

  // Minting (on PoB contract)
  mintSmt:       { '001': 'mintDevRel', '002': 'mintDevRel', '003': 'mintSmt' },

  // Admin: add entity-0 voter
  addSmtVoter:   { '001': 'setDevRelAccount', '002': 'setDevRelAccount', '003': 'addSmtVoter' },

  // Admin: remove entity-0 voter (v003 only; v001/v002 just use setDevRelAccount to replace)
  removeSmtVoter: { '003': 'removeSmtVoter' },
};

function resolve(action: string, version: string): string {
  const mapping = WRITE_MAP[action];
  if (!mapping) return action;
  return mapping[version] ?? mapping['003'] ?? action;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WriteTarget {
  jurySC: string;
  pob: string;
  version: string;
}

export interface WriteDispatcher {
  // Voting (targets jurySC)
  voteSmt(projectAddress: string): Promise<ContractTransactionResponse>;
  voteDaoHic(projectAddress: string): Promise<ContractTransactionResponse>;
  voteCommunity(tokenId: string, projectAddress: string): Promise<ContractTransactionResponse>;

  // Minting (targets pob)
  mintCommunity(value: bigint): Promise<ContractTransactionResponse>;
  mintSmt(): Promise<ContractTransactionResponse>;
  mintDaoHic(): Promise<ContractTransactionResponse>;
  mintProject(): Promise<ContractTransactionResponse>;

  // Claims (targets pob)
  claim(tokenId: string): Promise<ContractTransactionResponse>;

  // Admin (targets jurySC)
  activate(): Promise<ContractTransactionResponse>;
  closeManually(): Promise<ContractTransactionResponse>;
  registerProject(address: string): Promise<ContractTransactionResponse>;
  removeProject(address: string): Promise<ContractTransactionResponse>;
  addSmtVoter(address: string): Promise<ContractTransactionResponse>;
  addDaoHicVoter(address: string): Promise<ContractTransactionResponse>;
  removeDaoHicVoter(address: string): Promise<ContractTransactionResponse>;
  removeSmtVoter(address: string): Promise<ContractTransactionResponse>;
  lockContractForHistory(): Promise<ContractTransactionResponse>;
  setVotingMode(mode: number): Promise<ContractTransactionResponse>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWriteDispatcher(target: WriteTarget, signer: Signer): WriteDispatcher {
  const version = target.version || '003';
  const jury = new Contract(target.jurySC, JurySCWriteAllABI, signer);
  const pob  = new Contract(target.pob, PoBWriteAllABI, signer);

  return {
    // Voting
    voteSmt:       (project) => jury[resolve('voteSmt', version)](project),
    voteDaoHic:    (project) => jury.voteDaoHic(project),
    voteCommunity: (tokenId, project) => jury.voteCommunity(tokenId, project),

    // Minting
    mintCommunity: (value) => pob.mint({ value }),
    mintSmt:       () => pob[resolve('mintSmt', version)](),
    mintDaoHic:    () => pob.mintDaoHic(),
    mintProject:   () => pob.mintProject(),

    // Claims
    claim: (tokenId) => pob.claim(tokenId),

    // Admin
    activate:               () => jury.activate(),
    closeManually:          () => jury.closeManually(),
    registerProject:        (addr) => jury.registerProject(addr),
    removeProject:          (addr) => jury.removeProject(addr),
    addSmtVoter:            (addr) => jury[resolve('addSmtVoter', version)](addr),
    addDaoHicVoter:         (addr) => jury.addDaoHicVoter(addr),
    removeDaoHicVoter:      (addr) => jury.removeDaoHicVoter(addr),
    removeSmtVoter:         (addr) => jury[resolve('removeSmtVoter', version)](addr),
    lockContractForHistory: () => jury.lockContractForHistory(),
    setVotingMode:          (mode) => jury.setVotingMode(mode),
  };
}
