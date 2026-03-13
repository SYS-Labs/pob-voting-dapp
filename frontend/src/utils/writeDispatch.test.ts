import { beforeEach, describe, expect, it, vi } from 'vitest';

const contractFactory = vi.fn();

vi.mock('ethers', () => ({
  Contract: class MockContract {
    constructor(address: string, abi: unknown, runner: unknown) {
      return contractFactory(address, abi, runner);
    }
  },
}));

describe('writeDispatch', () => {
  let probeMode: 'v3' | 'legacy';
  let juryContract: Record<string, ReturnType<typeof vi.fn>>;
  let pobContract: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    probeMode = 'v3';

    juryContract = {
      addSmtVoter: vi.fn().mockResolvedValue({ hash: '0xadd' }),
      setDevRelAccount: vi.fn().mockResolvedValue({ hash: '0xlegacy' }),
      voteSmt: vi.fn().mockResolvedValue({ hash: '0xvote3' }),
      voteDevRel: vi.fn().mockResolvedValue({ hash: '0xvote2' }),
      voteDaoHic: vi.fn().mockResolvedValue({ hash: '0xdao' }),
      voteCommunity: vi.fn().mockResolvedValue({ hash: '0xcommunity' }),
      activate: vi.fn().mockResolvedValue({ hash: '0xactivate' }),
      closeManually: vi.fn().mockResolvedValue({ hash: '0xclose' }),
      registerProject: vi.fn().mockResolvedValue({ hash: '0xproject' }),
      removeProject: vi.fn().mockResolvedValue({ hash: '0xremoveproject' }),
      addDaoHicVoter: vi.fn().mockResolvedValue({ hash: '0xadddao' }),
      removeDaoHicVoter: vi.fn().mockResolvedValue({ hash: '0xremovedao' }),
      removeSmtVoter: vi.fn().mockResolvedValue({ hash: '0xremovesmt' }),
      lockContractForHistory: vi.fn().mockResolvedValue({ hash: '0xlock' }),
      setVotingMode: vi.fn().mockResolvedValue({ hash: '0xmode' }),
    };

    pobContract = {
      mint: vi.fn().mockResolvedValue({ hash: '0xmint' }),
      mintSmt: vi.fn().mockResolvedValue({ hash: '0xmintsmt' }),
      mintDevRel: vi.fn().mockResolvedValue({ hash: '0xmintdevrel' }),
      mintDaoHic: vi.fn().mockResolvedValue({ hash: '0xmintdao' }),
      mintProject: vi.fn().mockResolvedValue({ hash: '0xmintproject' }),
      claim: vi.fn().mockResolvedValue({ hash: '0xclaim' }),
    };

    contractFactory.mockImplementation((address: string, abi: unknown) => {
      if (Array.isArray(abi) && abi[0] === 'function getSmtVoters() view returns (address[])') {
        return {
          getSmtVoters: probeMode === 'v3'
            ? vi.fn().mockResolvedValue(['0x123'])
            : vi.fn().mockRejectedValue(new Error('missing function')),
        };
      }

      if (address.startsWith('0x1000')) {
        return juryContract;
      }

      return pobContract;
    });
  });

  it('detects v3 write routing from the jury contract', async () => {
    const { resolveWriteVersion } = await import('./writeDispatch');

    const version = await resolveWriteVersion(
      {
        chainId: 5700,
        jurySC: '0x1000000000000000000000000000000000000001',
        pob: '0x2000000000000000000000000000000000000001',
        version: '002',
      },
      {} as never,
    );

    expect(version).toBe('003');
  });

  it('uses addSmtVoter for v3 rounds even when the snapshot version is legacy', async () => {
    const { createWriteDispatcher } = await import('./writeDispatch');

    const writer = createWriteDispatcher(
      {
        chainId: 5700,
        jurySC: '0x1000000000000000000000000000000000000002',
        pob: '0x2000000000000000000000000000000000000002',
        version: '002',
      },
      {} as never,
    );

    await writer.addSmtVoter('0x3000000000000000000000000000000000000001');

    expect(juryContract.addSmtVoter).toHaveBeenCalledWith('0x3000000000000000000000000000000000000001');
    expect(juryContract.setDevRelAccount).not.toHaveBeenCalled();
  });

  it('falls back to the legacy DevRel setter when the jury is not v3', async () => {
    probeMode = 'legacy';
    const { createWriteDispatcher } = await import('./writeDispatch');

    const writer = createWriteDispatcher(
      {
        chainId: 5700,
        jurySC: '0x1000000000000000000000000000000000000003',
        pob: '0x2000000000000000000000000000000000000003',
        version: '002',
      },
      {} as never,
    );

    await writer.addSmtVoter('0x3000000000000000000000000000000000000002');

    expect(juryContract.setDevRelAccount).toHaveBeenCalledWith('0x3000000000000000000000000000000000000002');
    expect(juryContract.addSmtVoter).not.toHaveBeenCalled();
  });
});
