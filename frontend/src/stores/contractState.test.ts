import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Iteration } from '~/interfaces';
import type { IterationSnapshot } from '~/utils/iterations-api';

const mocks = vi.hoisted(() => ({
  getIteration: vi.fn(),
  resolveAdapter: vi.fn(),
  batchGetProjectMetadataCIDs: vi.fn(),
  batchGetByCIDs: vi.fn(),
}));

vi.mock('~/utils/iterations-api', () => ({
  iterationsAPI: {
    getIteration: mocks.getIteration,
  },
}));

vi.mock('~/utils/adapterResolver', () => ({
  resolveAdapter: mocks.resolveAdapter,
}));

vi.mock('~/utils/registry', () => ({
  batchGetProjectMetadataCIDs: mocks.batchGetProjectMetadataCIDs,
}));

vi.mock('~/utils/metadata-api', () => ({
  metadataAPI: {
    batchGetByCIDs: mocks.batchGetByCIDs,
  },
}));

import { contractStateStore, loadIterationState, resetContractState } from './contractState';
import { rpcCache } from '~/utils/cachedPromiseAll';

const currentIteration: Iteration = {
  iteration: 3,
  chainId: 57,
  round: 1,
  version: '004',
  name: 'Iteration #3',
  jurySC: '0x5a90d01F3eD27E6524e9c4631a3bB9C956E59208',
  pob: '0x6a866Cde7FDB558d88e6af1BC0cCB5f17E1aee52',
};

function makeSnapshot(projects: IterationSnapshot['projects']): IterationSnapshot {
  return {
    iterationId: currentIteration.iteration,
    chainId: currentIteration.chainId,
    round: currentIteration.round!,
    version: currentIteration.version!,
    registryAddress: '0xb2C3c1CB54aa9EBFe175a5fBEB63d63986D5a5E8',
    pobAddress: currentIteration.pob,
    juryAddress: currentIteration.jurySC,
    deployBlockHint: 0,
    juryState: 'locked',
    startTime: null,
    endTime: null,
    votingMode: 0,
    projectsLocked: true,
    contractLocked: true,
    winner: { projectAddress: null, hasWinner: false },
    entityVotes: { devRel: null, daoHic: null, community: null },
    projectScores: null,
    totals: { devRel: 0, daoHic: 0, community: 0 },
    devRelAccount: null,
    daoHicVoters: [],
    daoHicIndividualVotes: {},
    projects,
    lastBlock: 904854,
    lastUpdatedAt: 1776284654299,
  };
}

function makeAdapter(projectAddresses: string[]) {
  return {
    projectsLocked: vi.fn().mockResolvedValue(true),
    locked: vi.fn().mockResolvedValue(true),
    getProjectAddresses: vi.fn().mockResolvedValue(projectAddresses),
  };
}

function makeProvider() {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(904854),
  };
}

describe('contractState project loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContractState();
    rpcCache.clear();
  });

  it('reconciles an empty API project snapshot with the registry/adapter project list', async () => {
    const projectAddresses = [
      '0x5D86E67037F5aa8F8884064034379c1c2cA6D756',
      '0x380d778cC999B46Ff3D5eb5ce9805FC26Eb100Ab',
    ];
    const cids = ['bafkrei-project-a', 'bafkrei-project-b'];
    const adapter = makeAdapter(projectAddresses);

    mocks.getIteration.mockResolvedValue(makeSnapshot([]));
    mocks.resolveAdapter.mockResolvedValue({
      jurySC: currentIteration.jurySC,
      adapterAddress: '0xca91Ee9F3166947Dd98f536A51659147d96e3BDC',
      adapter,
    });
    mocks.batchGetProjectMetadataCIDs.mockResolvedValue(new Map([
      [projectAddresses[0], cids[0]],
      [projectAddresses[1], cids[1]],
    ]));
    mocks.batchGetByCIDs.mockResolvedValue({
      [cids[0]]: { name: 'Project A', account: projectAddresses[0], chainId: 57 },
      [cids[1]]: { name: 'Project B', account: projectAddresses[1], chainId: 57 },
    });

    await loadIterationState(
      null,
      null,
      currentIteration,
      makeProvider() as never,
      [currentIteration],
      'iteration',
      false
    );

    const state = get(contractStateStore);
    expect(adapter.getProjectAddresses).toHaveBeenCalledWith(currentIteration.jurySC);
    expect(mocks.batchGetProjectMetadataCIDs).toHaveBeenCalledWith(
      57,
      currentIteration.jurySC,
      projectAddresses,
      expect.anything()
    );
    expect(state.loading).toBe(false);
    expect(state.hasLoadError).toBe(false);
    expect(state.projects.map(project => project.metadata?.name)).toEqual(['Project A', 'Project B']);
  });

  it('uses API metadata as a fallback if the registry metadata batch request fails', async () => {
    const projectAddress = '0x5D86E67037F5aa8F8884064034379c1c2cA6D756';
    const adapter = makeAdapter([projectAddress]);

    mocks.getIteration.mockResolvedValue(makeSnapshot([
      {
        address: projectAddress,
        metadataCID: 'bafkrei-project-a',
        metadata: { name: 'API Project A', account: projectAddress, chainId: 57 },
      },
    ]));
    mocks.resolveAdapter.mockResolvedValue({
      jurySC: currentIteration.jurySC,
      adapterAddress: '0xca91Ee9F3166947Dd98f536A51659147d96e3BDC',
      adapter,
    });
    mocks.batchGetProjectMetadataCIDs.mockResolvedValue(new Map([
      [projectAddress, 'bafkrei-project-a'],
    ]));
    mocks.batchGetByCIDs.mockRejectedValue(new Error('metadata batch unavailable'));

    await loadIterationState(
      null,
      null,
      currentIteration,
      makeProvider() as never,
      [currentIteration],
      'iteration',
      false
    );

    const state = get(contractStateStore);
    expect(state.loading).toBe(false);
    expect(state.hasLoadError).toBe(false);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].metadata?.name).toBe('API Project A');
  });

  it('preserves complete API projects if the authoritative project address read fails', async () => {
    const projectAddress = '0x5D86E67037F5aa8F8884064034379c1c2cA6D756';
    const adapter = makeAdapter([projectAddress]);
    adapter.getProjectAddresses.mockRejectedValue(new Error('rpc unavailable'));

    mocks.getIteration.mockResolvedValue(makeSnapshot([
      {
        address: projectAddress,
        metadataCID: 'bafkrei-project-a',
        metadata: { name: 'API Project A', account: projectAddress, chainId: 57 },
      },
    ]));
    mocks.resolveAdapter.mockResolvedValue({
      jurySC: currentIteration.jurySC,
      adapterAddress: '0xca91Ee9F3166947Dd98f536A51659147d96e3BDC',
      adapter,
    });

    await loadIterationState(
      null,
      null,
      currentIteration,
      makeProvider() as never,
      [currentIteration],
      'iteration',
      false
    );

    const state = get(contractStateStore);
    expect(state.loading).toBe(false);
    expect(state.hasLoadError).toBe(false);
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].metadata?.name).toBe('API Project A');
  });

});
