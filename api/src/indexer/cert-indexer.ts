/**
 * Cert Indexer
 *
 * Polls the CertNFT contract to build snapshots of certificate state.
 * Also indexes profile data from PoBRegistry.
 * Stores snapshots in the database for fast API access.
 */

import Database from 'better-sqlite3';
import { ethers, Contract, JsonRpcProvider } from 'ethers';
import { logger } from '../utils/logger.js';
import { initDatabase } from '../db/init.js';
import { createCertsDatabase, type CertStatus } from '../db/certs.js';
import { createProfilesDatabase } from '../db/profiles.js';
import { createMetadataDatabase } from '../db/metadata.js';
import { createRetryTracker } from '../db/retry-tracker.js';
import { createIterationsDatabase } from '../db/iterations.js';
import { createTeamMembersDatabase, type TeamMemberStatus } from '../db/teamMembers.js';
import { createEligibilityDatabase } from '../db/eligibility.js';
import { IPFSService } from '../services/ipfs.js';
import { NETWORKS } from '../constants/networks.js';

// Minimal ABIs for contract calls
const CERT_NFT_ABI = [
  'function nextTokenId() view returns (uint256)',
  'function certs(uint256) view returns (uint256 iteration, address account, string certType, uint8 status, uint256 requestTime)',
  'function certStatus(uint256) view returns (uint8)',
  'function middleware(uint256) view returns (address)',
  'function hasNamedTeamMembers(uint256 iteration, address project) view returns (bool)',
];

const CERT_GATE_ABI = [
  'function validate(address) view returns (bool, string)',
  'function isProjectInAnyRound(address) view returns (bool)',
  'event RoleRegistered(address indexed account, string role)',
  'event RoleRemoved(address indexed account)',
];

const REGISTRY_TEMPLATE_ABI = [
  'function getIterationTemplate(uint256 iterationId) view returns (bytes32 hash, uint32 version, string cid)',
];

const CERT_NFT_TEAM_ABI = [
  'function getTeamMemberCount(uint256 iteration, address project) view returns (uint256)',
  'function getTeamMember(uint256 iteration, address project, uint256 index) view returns (address memberAddress, uint8 status, string fullName)',
];

const REGISTRY_PROFILE_ABI = [
  'function profilePictureCID(address) view returns (string)',
  'function profileBioCID(address) view returns (string)',
];

// Status enum mapping (matches CertNFT.CertStatus)
const STATUS_MAP: Record<number, CertStatus> = {
  0: 'pending',
  1: 'minted',
  2: 'cancelled',
  3: 'requested',
};

// Team member status enum mapping (matches CertNFT.MemberStatus)
const MEMBER_STATUS_MAP: Record<number, TeamMemberStatus> = {
  0: 'proposed',
  1: 'approved',
  2: 'rejected',
};

// Poll interval: 37 seconds (configurable via env)
const POLL_INTERVAL = parseInt(process.env.CERT_POLL_INTERVAL || '37000', 10);

// Optional: Force single chain mode
const SINGLE_CHAIN_ID = process.env.CHAIN_ID
  ? parseInt(process.env.CHAIN_ID, 10)
  : null;

class CertIndexer {
  private db: Database.Database;
  private certsDb: ReturnType<typeof createCertsDatabase>;
  private profilesDb: ReturnType<typeof createProfilesDatabase>;
  private metadataDb: ReturnType<typeof createMetadataDatabase>;
  private iterationsDb: ReturnType<typeof createIterationsDatabase>;
  private teamMembersDb: ReturnType<typeof createTeamMembersDatabase>;
  private eligibilityDb: ReturnType<typeof createEligibilityDatabase>;
  private retryTracker: ReturnType<typeof createRetryTracker>;
  private ipfsService: IPFSService;
  private providers: Map<number, JsonRpcProvider> = new Map();
  private isRunning = false;
  // Tracks the next-unscanned block per (chainId, middlewareAddress) for
  // incremental role-event scanning (RoleRegistered + RoleRemoved). Resets to
  // 0 on restart (safe because upserts are idempotent), then advances each poll.
  private readonly roleEventCheckpoints = new Map<string, number>();

  constructor(dbPath?: string) {
    const path = dbPath || process.env.DB_PATH || './data/index.db';
    this.db = initDatabase(path);
    this.certsDb = createCertsDatabase(this.db);
    this.profilesDb = createProfilesDatabase(this.db);
    this.metadataDb = createMetadataDatabase(this.db);
    this.iterationsDb = createIterationsDatabase(this.db);
    this.teamMembersDb = createTeamMembersDatabase(this.db);
    this.eligibilityDb = createEligibilityDatabase(this.db);
    this.retryTracker = createRetryTracker(this.db);
    this.ipfsService = new IPFSService();

    // Initialize providers for each network with a certNFTAddress
    for (const [chainId, config] of Object.entries(NETWORKS)) {
      const id = Number(chainId);
      if (SINGLE_CHAIN_ID !== null && id !== SINGLE_CHAIN_ID) {
        continue;
      }
      if (config.certNFTAddress) {
        this.providers.set(id, new JsonRpcProvider(config.rpcUrl));
      }
    }
  }

  /**
   * Fetch metadata from IPFS and cache it, with retry tracking
   */
  private async fetchAndCacheMetadata(cid: string): Promise<Record<string, unknown> | null> {
    if (!cid || cid.length === 0) return null;

    // Check cache first
    const cached = this.metadataDb.getCachedIPFSContent(cid);
    if (cached) {
      try {
        return JSON.parse(cached.content);
      } catch {
        // Invalid JSON in cache
      }
    }

    if (!this.retryTracker.shouldRetry('ipfs', 'fetch', cid)) {
      return null;
    }

    try {
      const data = await this.ipfsService.fetchJSON(cid);
      this.metadataDb.cacheIPFSContent(cid, JSON.stringify(data));
      this.retryTracker.recordSuccess('ipfs', 'fetch', cid);
      logger.debug('Fetched and cached IPFS metadata', { cid });
      return data as Record<string, unknown>;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.retryTracker.recordFailure('ipfs', 'fetch', cid, errorMsg);
      logger.warn('Failed to fetch IPFS metadata', { cid, error: errorMsg });
      return null;
    }
  }

  /**
   * Get template CID from PoBRegistry for a given iteration
   */
  private async getTemplateCID(
    registryAddress: string,
    iteration: number,
    provider: JsonRpcProvider
  ): Promise<string | null> {
    if (!registryAddress || registryAddress === ethers.ZeroAddress) {
      return null;
    }

    try {
      const registry = new Contract(registryAddress, REGISTRY_TEMPLATE_ABI, provider);
      const [, , cid] = await registry.getIterationTemplate(iteration);
      return cid && cid.length > 0 ? cid : null;
    } catch {
      return null;
    }
  }

  /**
   * Index certs for a single chain
   */
  private async indexChainCerts(chainId: number): Promise<void> {
    const config = NETWORKS[chainId];
    if (!config.certNFTAddress) return;

    const provider = this.providers.get(chainId);
    if (!provider) return;

    const certNFT = new Contract(config.certNFTAddress, CERT_NFT_ABI, provider);

    try {
      // Get upper bound of token IDs
      let nextTokenIdBN;
      try {
        nextTokenIdBN = await certNFT.nextTokenId();
      } catch (err: any) {
        if (err?.code === 'BAD_DATA') {
          // Contract not deployed at this address (stale deployment file or node restarted)
          logger.warn('CertNFT contract not found at configured address, skipping', {
            chainId,
            address: config.certNFTAddress,
          });
          return;
        }
        throw err;
      }
      const nextTokenId = Number(nextTokenIdBN);

      // Get highest token ID we've already indexed
      const highestIndexed = this.certsDb.getHighestTokenId(chainId);

      // Index new tokens
      for (let tokenId = highestIndexed + 1; tokenId < nextTokenId; tokenId++) {
        try {
          await this.indexCert(chainId, tokenId, certNFT, provider);
        } catch (error) {
          logger.warn('Failed to index cert', { chainId, tokenId, error });
        }
      }

      // Re-check non-final certs (status may have changed, e.g. cancelled → requested via resubmit)
      const pendingCerts = this.certsDb.getNonFinalCerts(chainId);
      for (const cert of pendingCerts) {
        try {
          const statusRaw = await certNFT.certStatus(cert.token_id);
          const newStatus = STATUS_MAP[Number(statusRaw)] || 'pending';

          if (newStatus !== cert.status) {
            this.certsDb.upsertCert({
              ...cert,
              status: newStatus,
              last_updated_at: Date.now(),
            });
            logger.info('Cert status updated', {
              chainId,
              tokenId: cert.token_id,
              oldStatus: cert.status,
              newStatus,
            });
          }
        } catch (error) {
          logger.warn('Failed to re-check pending cert', {
            chainId,
            tokenId: cert.token_id,
            error,
          });
        }
      }

      if (nextTokenId > 1) {
        logger.debug('Cert indexing complete for chain', {
          chainId,
          highestIndexed,
          nextTokenId,
          pendingRechecked: pendingCerts.length,
        });
      }
    } catch (error) {
      logger.error('Failed to index certs for chain', { chainId, error });
    }
  }

  /**
   * Index a single cert by token ID
   */
  private async indexCert(
    chainId: number,
    tokenId: number,
    certNFT: Contract,
    provider: JsonRpcProvider
  ): Promise<void> {
    const [certData, statusRaw] = await Promise.all([
      certNFT.certs(tokenId),
      certNFT.certStatus(tokenId),
    ]);

    const iteration = Number(certData.iteration);
    const account = certData.account;
    const certType = certData.certType;
    const status = STATUS_MAP[Number(statusRaw)] || 'pending';
    const requestTime = Number(certData.requestTime);

    // Get middleware (gate) address for this iteration
    const middlewareAddress = await certNFT.middleware(iteration).catch(() => ethers.ZeroAddress);

    // Get template CID from PoBRegistry (source of truth after API publish)
    const registryAddress = NETWORKS[chainId].registryAddress || '';
    const templateCID = await this.getTemplateCID(registryAddress, iteration, provider);

    if (templateCID) {
      await this.fetchAndCacheMetadata(templateCID);
    }

    this.certsDb.upsertCert({
      chain_id: chainId,
      cert_nft_address: NETWORKS[chainId].certNFTAddress,
      token_id: tokenId,
      iteration,
      account,
      cert_type: certType,
      status,
      request_time: requestTime,
      middleware_address: middlewareAddress !== ethers.ZeroAddress ? middlewareAddress : null,
      template_cid: templateCID,
      last_updated_at: Date.now(),
    });

    logger.info('Indexed cert', { chainId, tokenId, iteration, account, certType, status });
  }

  /**
   * Index team members for known projects from iteration snapshots
   */
  private async indexChainTeamMembers(chainId: number): Promise<void> {
    const config = NETWORKS[chainId];
    if (!config.certNFTAddress) return;

    const provider = this.providers.get(chainId);
    if (!provider) return;

    const certNFT = new Contract(config.certNFTAddress, [...CERT_NFT_ABI, ...CERT_NFT_TEAM_ABI], provider);

    // Collect project addresses from iteration snapshots
    const projectsByIteration = new Map<number, string[]>();
    try {
      const snapshots = this.iterationsDb.getSnapshotsByChain(chainId);
      for (const snapshot of snapshots) {
        if (snapshot.projects) {
          try {
            const projects: { address: string }[] = JSON.parse(snapshot.projects);
            const addresses = projects.map((p) => p.address);
            if (addresses.length > 0) {
              projectsByIteration.set(snapshot.iteration_id, addresses);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      // Iteration data might not be indexed yet
    }

    if (projectsByIteration.size === 0) return;

    let totalIndexed = 0;
    for (const [iteration, projectAddresses] of projectsByIteration) {
      for (const projectAddress of projectAddresses) {
        try {
          const count = Number(await certNFT.getTeamMemberCount(iteration, projectAddress));
          const onChainAddresses: string[] = [];
          let fetchError = false;
          for (let i = 0; i < count; i++) {
            try {
              const [memberAddress, statusRaw, fullName] = await certNFT.getTeamMember(iteration, projectAddress, i);
              const status = MEMBER_STATUS_MAP[Number(statusRaw)] || 'proposed';
              onChainAddresses.push(memberAddress.toLowerCase());

              this.teamMembersDb.upsertTeamMember({
                chain_id: chainId,
                iteration,
                project_address: projectAddress,
                member_address: memberAddress,
                status,
                full_name: fullName || '',
                last_updated_at: Date.now(),
              });
              totalIndexed++;
            } catch (error) {
              fetchError = true;
              logger.warn('Failed to index team member', { chainId, iteration, projectAddress, index: i, error });
            }
          }
          // Prune members removed on-chain, but only if all fetches succeeded
          if (!fetchError) {
            this.teamMembersDb.deleteTeamMembersNotIn(chainId, iteration, projectAddress, onChainAddresses);
          }
        } catch (error) {
          logger.warn('Failed to get team member count', { chainId, iteration, projectAddress, error });
        }
      }
    }

    if (totalIndexed > 0) {
      logger.debug('Team member indexing complete for chain', { chainId, totalIndexed });
    }
  }

  /**
   * Index eligibility for candidate accounts from iteration snapshots
   */
  private async indexChainEligibility(chainId: number): Promise<void> {
    const config = NETWORKS[chainId];
    if (!config.certNFTAddress) return;

    const provider = this.providers.get(chainId);
    if (!provider) return;

    const certNFT = new Contract(config.certNFTAddress, CERT_NFT_ABI, provider);

    // Fetch current block once so all event-range queries in this pass share the same toBlock.
    let currentBlock = 0;
    try {
      currentBlock = Number(await provider.getBlockNumber());
    } catch { /* fall back to full-history scan */ }

    // Collect candidate accounts from iteration snapshots where voting ended
    const snapshots = this.iterationsDb.getSnapshotsByChain(chainId);
    let totalChecked = 0;

    for (const snapshot of snapshots) {
      // Only check iterations where voting has ended
      if (snapshot.jury_state !== 'ended' && snapshot.jury_state !== 'locked') continue;

      const iteration = snapshot.iteration_id;

      // Get middleware address
      let middlewareAddress: string;
      try {
        middlewareAddress = await certNFT.middleware(iteration);
      } catch {
        continue;
      }
      if (!middlewareAddress || middlewareAddress === ethers.ZeroAddress) continue;

      const middleware = new Contract(middlewareAddress, CERT_GATE_ABI, provider);

      // Collect candidate accounts
      const candidates = new Set<string>();
      if (snapshot.devrel_account) {
        candidates.add(snapshot.devrel_account.toLowerCase());
      }
      if (snapshot.daohic_voters) {
        try {
          const voters: string[] = JSON.parse(snapshot.daohic_voters);
          for (const v of voters) candidates.add(v.toLowerCase());
        } catch { /* ignore */ }
      }
      if (snapshot.projects) {
        try {
          const projects: { address: string }[] = JSON.parse(snapshot.projects);
          for (const p of projects) candidates.add(p.address.toLowerCase());
        } catch { /* ignore */ }
      }

      // Also include accounts touched by role admin actions.
      // RoleRegistered accounts can be eligible via registeredRole bypass.
      // RoleRemoved accounts must be revalidated so stale eligible=1 rows are cleared.
      // Uses an incremental block range so each poll only scans new blocks.
      const checkpointKey = `${chainId}-${middlewareAddress}`;
      const fromBlock = this.roleEventCheckpoints.get(checkpointKey) ?? 0;
      try {
        const toBlock = currentBlock > 0 ? currentBlock : 'latest';
        const [registeredEvents, removedEvents] = await Promise.all([
          middleware.queryFilter(
            middleware.filters.RoleRegistered(),
            fromBlock,
            toBlock
          ),
          middleware.queryFilter(
            middleware.filters.RoleRemoved(),
            fromBlock,
            toBlock
          ),
        ]);

        for (const event of [...registeredEvents, ...removedEvents]) {
          const account = (event as any).args?.account;
          if (account) candidates.add(account.toLowerCase());
        }
        if (currentBlock > 0) {
          this.roleEventCheckpoints.set(checkpointKey, currentBlock + 1);
        }
      } catch { /* ignore — older middleware or RPC issue */ }

      for (const account of candidates) {
        try {
          const [eligible, certType] = await middleware.validate(account);
          let isProjectFlag = false;
          let hasNamedFlag = false;

          if (eligible) {
            try {
              isProjectFlag = await middleware.isProjectInAnyRound(account);
            } catch { /* ignore */ }

            if (isProjectFlag) {
              try {
                hasNamedFlag = await certNFT.hasNamedTeamMembers(iteration, account);
              } catch { /* ignore */ }
            }
          }

          this.eligibilityDb.upsertEligibility({
            chain_id: chainId,
            iteration,
            account,
            eligible: eligible ? 1 : 0,
            cert_type: certType || '',
            is_project: isProjectFlag ? 1 : 0,
            has_named_team_members: hasNamedFlag ? 1 : 0,
            last_updated_at: Date.now(),
          });
          totalChecked++;
        } catch (error) {
          logger.warn('Failed to check eligibility', { chainId, iteration, account, error });
        }
      }
    }

    if (totalChecked > 0) {
      logger.debug('Eligibility indexing complete for chain', { chainId, totalChecked });
    }
  }

  /**
   * Index profiles for accounts seen in certs and iteration snapshots
   */
  private async indexChainProfiles(chainId: number): Promise<void> {
    const config = NETWORKS[chainId];
    if (!config.registryAddress) return;

    const provider = this.providers.get(chainId);
    if (!provider) return;

    const registry = new Contract(config.registryAddress, REGISTRY_PROFILE_ABI, provider);

    // Collect unique accounts from cert_snapshots
    const certAccounts = new Set<string>();

    // Get accounts from cert_snapshots directly
    try {
      const stmt = this.db.prepare(`
        SELECT DISTINCT account FROM cert_snapshots WHERE chain_id = ?
      `);
      const rows = stmt.all(chainId) as { account: string }[];
      for (const row of rows) {
        certAccounts.add(row.account.toLowerCase());
      }
    } catch {
      // Table might not have data yet
    }

    // Get accounts from iteration_snapshots (devrel, daohic, projects)
    try {
      const snapshots = this.iterationsDb.getSnapshotsByChain(chainId);
      for (const snapshot of snapshots) {
        if (snapshot.devrel_account) {
          certAccounts.add(snapshot.devrel_account.toLowerCase());
        }
        if (snapshot.daohic_voters) {
          try {
            const voters: string[] = JSON.parse(snapshot.daohic_voters);
            for (const voter of voters) {
              certAccounts.add(voter.toLowerCase());
            }
          } catch { /* ignore parse errors */ }
        }
        if (snapshot.projects) {
          try {
            const projects: { address: string }[] = JSON.parse(snapshot.projects);
            for (const project of projects) {
              certAccounts.add(project.address.toLowerCase());
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      // Iteration data might not be indexed yet
    }

    if (certAccounts.size === 0) return;

    // Check profiles for each account
    for (const account of certAccounts) {
      try {
        const [pictureCID, bioCID] = await Promise.all([
          registry.profilePictureCID(account).catch(() => ''),
          registry.profileBioCID(account).catch(() => ''),
        ]);

        // Only store if account has at least one profile field set
        if (pictureCID || bioCID) {
          this.profilesDb.upsertProfile({
            chain_id: chainId,
            account,
            picture_cid: pictureCID || '',
            bio_cid: bioCID || '',
            last_updated_at: Date.now(),
          });

          // Cache IPFS content
          if (pictureCID) await this.fetchAndCacheMetadata(pictureCID);
          if (bioCID) await this.fetchAndCacheMetadata(bioCID);
        }
      } catch (error) {
        logger.warn('Failed to index profile', { chainId, account, error });
      }
    }

    logger.debug('Profile indexing complete for chain', {
      chainId,
      accountsChecked: certAccounts.size,
    });
  }

  /**
   * Run a single poll cycle
   */
  async poll(): Promise<void> {
    logger.debug('Starting cert indexer poll');
    const startTime = Date.now();

    const chainIds = Array.from(this.providers.keys());

    // Index certs, team members, and profiles for all chains
    for (const chainId of chainIds) {
      await this.indexChainCerts(chainId);
      await this.indexChainTeamMembers(chainId);
      await this.indexChainEligibility(chainId);
      await this.indexChainProfiles(chainId);
    }

    logger.info('Cert indexer poll complete', {
      duration: Date.now() - startTime,
      chains: chainIds.length,
    });
  }

  /**
   * Start the indexer with continuous polling
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Cert indexer is already running');
      return;
    }

    logger.info('Starting cert indexer', {
      pollInterval: POLL_INTERVAL,
      chains: Array.from(this.providers.keys()),
      singleChainMode: SINGLE_CHAIN_ID !== null ? SINGLE_CHAIN_ID : false,
    });

    // Initial poll
    await this.poll();

    this.isRunning = true;

    setInterval(() => {
      if (!this.isRunning) return;

      this.poll().catch((error) => {
        logger.error('Cert indexer poll failed', { error });
      });
    }, POLL_INTERVAL);

    logger.info('Cert indexer started');
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    logger.info('Stopping cert indexer');
    this.isRunning = false;
    this.db.close();
    logger.info('Cert indexer stopped');
  }
}

// Start the indexer when this file is executed directly
const indexer = new CertIndexer();
indexer.start().catch((error) => {
  logger.error('Cert indexer failed to start', { error });
  process.exit(1);
});

export { CertIndexer };
