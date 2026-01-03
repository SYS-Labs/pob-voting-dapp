import { expect } from 'chai';
import hre from 'hardhat';
const { ethers, upgrades } = hre;

describe('PoBRegistry', function () {
  let PoBRegistry;
  let registry;
  let owner;
  let project1;
  let project2;
  let unauthorized;

  const CHAIN_ID_TESTNET = 5700;
  const CHAIN_ID_MAINNET = 57;
  const SAMPLE_CID = 'QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYywCzK1';
  const UPDATED_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

  beforeEach(async function () {
    [owner, project1, project2, unauthorized] = await ethers.getSigners();

    PoBRegistry = await ethers.getContractFactory('PoBRegistry');
    registry = await upgrades.deployProxy(
      PoBRegistry,
      [owner.address],
      { initializer: 'initialize' }
    );
    await registry.waitForDeployment();
  });

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it('Should be upgradeable', async function () {
      const registryAddress = await registry.getAddress();
      expect(registryAddress).to.be.properAddress;
    });
  });

  describe('Iteration Metadata', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should allow owner to set iteration metadata', async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID)
      )
        .to.emit(registry, 'IterationMetadataSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID, owner.address);

      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC);
      expect(cid).to.equal(SAMPLE_CID);
    });

    it('Should allow owner to update iteration metadata', async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID);
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, UPDATED_CID);

      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC);
      expect(cid).to.equal(UPDATED_CID);
    });

    it('Should not allow non-owner to set iteration metadata', async function () {
      await expect(
        registry.connect(unauthorized).setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID)
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should revert with invalid contract address', async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, ethers.ZeroAddress, SAMPLE_CID)
      ).to.be.revertedWith('Invalid contract address');
    });

    it('Should revert with empty CID', async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, '')
      ).to.be.revertedWith('CID cannot be empty');
    });

    it('Should return empty string for unset metadata', async function () {
      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC);
      expect(cid).to.equal('');
    });

    it('Should handle multiple chains independently', async function () {
      const testnetCID = 'QmTestnet123';
      const mainnetCID = 'QmMainnet456';

      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, testnetCID);
      await registry.setIterationMetadata(CHAIN_ID_MAINNET, mockJurySC, mainnetCID);

      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC)).to.equal(testnetCID);
      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, mockJurySC)).to.equal(mainnetCID);
    });
  });

  describe('Previous Round Contracts', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';
    const prevRound1 = '0xafbdCDB66534cec38adec528892a452852E9B51e';
    const prevRound2 = '0xbE0BB73f2b9038cf97DCC8e00baE5628dfde6712';

    it('Should allow owner to set previous rounds', async function () {
      const prevRounds = [prevRound1, prevRound2];

      await expect(
        registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC, prevRounds)
      )
        .to.emit(registry, 'PrevRoundsSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, prevRounds);

      const rounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC);
      expect(rounds).to.have.lengthOf(2);
      expect(rounds[0]).to.equal(prevRound1);
      expect(rounds[1]).to.equal(prevRound2);
    });

    it('Should allow empty previous rounds array', async function () {
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC, []);
      const rounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC);
      expect(rounds).to.have.lengthOf(0);
    });

    it('Should not allow non-owner to set previous rounds', async function () {
      await expect(
        registry.connect(unauthorized).setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC, [prevRound1])
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should return empty array for unset previous rounds', async function () {
      const rounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC);
      expect(rounds).to.have.lengthOf(0);
    });
  });

  describe('Project Authorization', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should allow owner to authorize a project', async function () {
      await expect(
        registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true)
      )
        .to.emit(registry, 'ProjectAuthorized')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      expect(
        await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)
      ).to.be.true;
    });

    it('Should allow owner to deauthorize a project', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, false);

      expect(
        await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)
      ).to.be.false;
    });

    it('Should allow batch authorization', async function () {
      const projects = [project1.address, project2.address];

      await registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, projects);

      expect(await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.be.true;
      expect(await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project2.address)).to.be.true;
    });

    it('Should not allow non-owner to authorize projects', async function () {
      await expect(
        registry.connect(unauthorized).setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true)
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should return false for non-authorized projects', async function () {
      expect(
        await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, unauthorized.address)
      ).to.be.false;
    });
  });

  describe('Project Metadata', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    beforeEach(async function () {
      // Authorize project1
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
    });

    it('Should allow authorized project to set its own metadata', async function () {
      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          SAMPLE_CID
        )
      )
        .to.emit(registry, 'ProjectMetadataSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, project1.address, SAMPLE_CID, project1.address);

      const cid = await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address);
      expect(cid).to.equal(SAMPLE_CID);
    });

    it('Should allow owner to set any project metadata', async function () {
      await registry.setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project2.address,
        SAMPLE_CID
      );

      const cid = await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project2.address);
      expect(cid).to.equal(SAMPLE_CID);
    });

    it('Should not allow unauthorized project to set metadata', async function () {
      await expect(
        registry.connect(unauthorized).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          unauthorized.address,
          SAMPLE_CID
        )
      ).to.be.revertedWith('Not authorized to set metadata');
    });

    it('Should not allow project to set another project metadata', async function () {
      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project2.address,
          SAMPLE_CID
        )
      ).to.be.revertedWith('Not authorized to set metadata');
    });

    it('Should revert with empty CID', async function () {
      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          ''
        )
      ).to.be.revertedWith('CID cannot be empty');
    });

    it('Should return empty string for unset project metadata', async function () {
      const cid = await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address);
      expect(cid).to.equal('');
    });

    it('Should handle batch get project metadata', async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address, 'QmProject1');
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project2.address, 'QmProject2');

      const cids = await registry.batchGetProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        [project1.address, project2.address, unauthorized.address]
      );

      expect(cids).to.have.lengthOf(3);
      expect(cids[0]).to.equal('QmProject1');
      expect(cids[1]).to.equal('QmProject2');
      expect(cids[2]).to.equal(''); // Unset
    });
  });

  describe('UUPS Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const PoBRegistryV2 = await ethers.getContractFactory('PoBRegistry', owner);
      const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2);
      expect(await upgraded.owner()).to.equal(owner.address);
    });

    it('Should not allow non-owner to upgrade', async function () {
      const PoBRegistryV2 = await ethers.getContractFactory('PoBRegistry', unauthorized);
      await expect(
        upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2)
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should preserve data after upgrade', async function () {
      const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

      // Set some data before upgrade
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID);
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        'QmProject1'
      );

      // Upgrade
      const PoBRegistryV2 = await ethers.getContractFactory('PoBRegistry', owner);
      const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2);

      // Verify data preserved
      expect(await upgraded.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC)).to.equal(SAMPLE_CID);
      expect(await upgraded.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.be.true;
      expect(await upgraded.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.equal('QmProject1');
    });
  });

  describe('Edge Cases and Boundary Conditions', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should enforce MAX_CID_LENGTH limit', async function () {
      const maxCID = 'Qm' + 'a'.repeat(98); // Total 100 chars
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, maxCID);
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC)).to.equal(maxCID);

      const tooLongCID = 'Qm' + 'a'.repeat(99); // Total 101 chars
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, tooLongCID)
      ).to.be.revertedWith('CID too long');
    });

    it('Should handle special characters in CID', async function () {
      const specialCID = 'QmSpecial-CID_123.test';
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, specialCID);
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC)).to.equal(specialCID);
    });

    it('Should enforce MAX_PREV_ROUNDS limit', async function () {
      const maxRounds = Array.from({ length: 100 }, (_, i) =>
        ethers.Wallet.createRandom().address
      );
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC, maxRounds);
      const rounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC);
      expect(rounds).to.have.lengthOf(100);

      const tooManyRounds = Array.from({ length: 101 }, (_, i) =>
        ethers.Wallet.createRandom().address
      );
      await expect(
        registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC, tooManyRounds)
      ).to.be.revertedWith('Too many previous rounds');
    });

    it('Should handle batch operations with empty array', async function () {
      const cids = await registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, []);
      expect(cids).to.have.lengthOf(0);
    });

    it('Should handle batch operations with single item', async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address, SAMPLE_CID);
      const cids = await registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, [project1.address]);
      expect(cids).to.have.lengthOf(1);
      expect(cids[0]).to.equal(SAMPLE_CID);
    });

    it('Should handle maximum uint256 for chainId', async function () {
      const maxChainId = ethers.MaxUint256;
      await registry.setIterationMetadata(maxChainId, mockJurySC, SAMPLE_CID);
      expect(await registry.getIterationMetadata(maxChainId, mockJurySC)).to.equal(SAMPLE_CID);
    });

    it('Should handle zero chainId', async function () {
      await registry.setIterationMetadata(0, mockJurySC, SAMPLE_CID);
      expect(await registry.getIterationMetadata(0, mockJurySC)).to.equal(SAMPLE_CID);
    });

    it('Should revert batch authorize with zero address in array', async function () {
      const projects = [project1.address, ethers.ZeroAddress, project2.address];
      await expect(
        registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, projects)
      ).to.be.revertedWith('Invalid project address');
    });

    it('Should revert setProjectAuthorization with zero project address', async function () {
      await expect(
        registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, ethers.ZeroAddress, true)
      ).to.be.revertedWith('Invalid project address');
    });

    it('Should revert setProjectMetadata with zero project address', async function () {
      await expect(
        registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, ethers.ZeroAddress, SAMPLE_CID)
      ).to.be.revertedWith('Invalid project address');
    });

    it('Should revert setProjectMetadata with zero jurySC address', async function () {
      await expect(
        registry.setProjectMetadata(CHAIN_ID_TESTNET, ethers.ZeroAddress, project1.address, SAMPLE_CID)
      ).to.be.revertedWith('Invalid contract address');
    });

    it('Should revert setPrevRoundContracts with zero jurySC address', async function () {
      await expect(
        registry.setPrevRoundContracts(CHAIN_ID_TESTNET, ethers.ZeroAddress, [])
      ).to.be.revertedWith('Invalid contract address');
    });

    it('Should revert setProjectAuthorization with zero jurySC address', async function () {
      await expect(
        registry.setProjectAuthorization(CHAIN_ID_TESTNET, ethers.ZeroAddress, project1.address, true)
      ).to.be.revertedWith('Invalid contract address');
    });

    it('Should enforce MAX_BATCH_SIZE in batchAuthorizeProjects', async function () {
      const maxBatch = Array.from({ length: 50 }, () => ethers.Wallet.createRandom().address);
      await registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, maxBatch);

      const tooBigBatch = Array.from({ length: 51 }, () => ethers.Wallet.createRandom().address);
      await expect(
        registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, tooBigBatch)
      ).to.be.revertedWith('Batch size too large');
    });

    it('Should enforce MAX_BATCH_SIZE in batchGetProjectMetadata', async function () {
      const maxBatch = Array.from({ length: 50 }, () => ethers.Wallet.createRandom().address);
      const cids = await registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, maxBatch);
      expect(cids).to.have.lengthOf(50);

      const tooBigBatch = Array.from({ length: 51 }, () => ethers.Wallet.createRandom().address);
      await expect(
        registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, tooBigBatch)
      ).to.be.revertedWith('Batch size too large');
    });

    it('Should enforce MAX_CID_LENGTH in setProjectMetadata', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      const maxCID = 'Qm' + 'a'.repeat(98); // Total 100 chars
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        maxCID
      );
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.equal(maxCID);

      const tooLongCID = 'Qm' + 'a'.repeat(99); // Total 101 chars
      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          tooLongCID
        )
      ).to.be.revertedWith('CID too long');
    });
  });

  describe('Security and Access Control', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should prevent authorization bypass by setting own metadata without authorization', async function () {
      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          SAMPLE_CID
        )
      ).to.be.revertedWith('Not authorized to set metadata');
    });

    it('Should prevent project from authorizing itself', async function () {
      await expect(
        registry.connect(project1).setProjectAuthorization(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          true
        )
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should allow owner to override project metadata even when project is authorized', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        'QmOldCID'
      );

      await registry.setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        'QmNewCID'
      );

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address))
        .to.equal('QmNewCID');
    });

    it('Should allow deauthorized project metadata to persist after deauthorization', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        SAMPLE_CID
      );

      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, false);

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address))
        .to.equal(SAMPLE_CID);
    });

    it('Should prevent deauthorized project from updating metadata', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySC,
        project1.address,
        SAMPLE_CID
      );

      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, false);

      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          UPDATED_CID
        )
      ).to.be.revertedWith('Not authorized to set metadata');
    });

    it('Should maintain separate authorization per chain', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      expect(await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.be.true;
      expect(await registry.isProjectAuthorized(CHAIN_ID_MAINNET, mockJurySC, project1.address)).to.be.false;
    });

    it('Should maintain separate authorization per jurySC', async function () {
      const jurySC2 = '0x1234567890123456789012345678901234567890';
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      expect(await registry.isProjectAuthorized(CHAIN_ID_TESTNET, mockJurySC, project1.address)).to.be.true;
      expect(await registry.isProjectAuthorized(CHAIN_ID_TESTNET, jurySC2, project1.address)).to.be.false;
    });

    it('Should not allow ownership renouncement to brick contract', async function () {
      await registry.renounceOwnership();
      expect(await registry.owner()).to.equal(ethers.ZeroAddress);

      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID)
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('Should allow ownership transfer', async function () {
      await registry.transferOwnership(project1.address);
      expect(await registry.owner()).to.equal(project1.address);

      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID)
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');

      await registry.connect(project1).setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID);
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC)).to.equal(SAMPLE_CID);
    });
  });

  describe('Data Isolation and Integrity', function () {
    const mockJurySC1 = '0x837992aC7b89c148F7e42755816e74E84CF985AD';
    const mockJurySC2 = '0xafbdCDB66534cec38adec528892a452852E9B51e';

    it('Should isolate iteration metadata by chain and jurySC', async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC1, 'QmTestnet1');
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC2, 'QmTestnet2');
      await registry.setIterationMetadata(CHAIN_ID_MAINNET, mockJurySC1, 'QmMainnet1');
      await registry.setIterationMetadata(CHAIN_ID_MAINNET, mockJurySC2, 'QmMainnet2');

      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC1)).to.equal('QmTestnet1');
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySC2)).to.equal('QmTestnet2');
      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, mockJurySC1)).to.equal('QmMainnet1');
      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, mockJurySC2)).to.equal('QmMainnet2');
    });

    it('Should isolate project metadata across different iterations', async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC1, project1.address, 'QmIter1');
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC2, project1.address, 'QmIter2');

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC1, project1.address))
        .to.equal('QmIter1');
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, mockJurySC2, project1.address))
        .to.equal('QmIter2');
    });

    it('Should isolate previous rounds per chain and jurySC', async function () {
      const rounds1 = [ethers.Wallet.createRandom().address];
      const rounds2 = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];

      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1, rounds1);
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC2, rounds2);

      const retrieved1 = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1);
      const retrieved2 = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC2);

      expect(retrieved1).to.have.lengthOf(1);
      expect(retrieved2).to.have.lengthOf(2);
      expect(retrieved1[0]).to.equal(rounds1[0]);
      expect(retrieved2[0]).to.equal(rounds2[0]);
    });

    it('Should allow overwriting previous rounds array', async function () {
      const rounds1 = [ethers.Wallet.createRandom().address];
      const rounds2 = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];

      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1, rounds1);
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1, rounds2);

      const retrieved = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1);
      expect(retrieved).to.have.lengthOf(2);
    });

    it('Should allow clearing previous rounds by setting empty array', async function () {
      const rounds = [ethers.Wallet.createRandom().address];
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1, rounds);
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1, []);

      const retrieved = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, mockJurySC1);
      expect(retrieved).to.have.lengthOf(0);
    });
  });

  describe('Event Emission Verification', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should emit correct events for batch authorization', async function () {
      const projects = [project1.address, project2.address];

      const tx = await registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, projects);
      const receipt = await tx.wait();

      const events = receipt.logs.filter(log => {
        try {
          return registry.interface.parseLog(log)?.name === 'ProjectAuthorized';
        } catch {
          return false;
        }
      });

      expect(events).to.have.lengthOf(2);
    });

    it('Should emit ProjectMetadataSet with correct setter address for owner', async function () {
      await expect(
        registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySC, project1.address, SAMPLE_CID)
      )
        .to.emit(registry, 'ProjectMetadataSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, project1.address, SAMPLE_CID, owner.address);
    });

    it('Should emit ProjectMetadataSet with correct setter address for authorized project', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      await expect(
        registry.connect(project1).setProjectMetadata(
          CHAIN_ID_TESTNET,
          mockJurySC,
          project1.address,
          SAMPLE_CID
        )
      )
        .to.emit(registry, 'ProjectMetadataSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, project1.address, SAMPLE_CID, project1.address);
    });

    it('Should emit events when updating existing metadata', async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID);

      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, UPDATED_CID)
      )
        .to.emit(registry, 'IterationMetadataSet')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, UPDATED_CID, owner.address);
    });

    it('Should emit ProjectAuthorized when deauthorizing', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, true);

      await expect(
        registry.setProjectAuthorization(CHAIN_ID_TESTNET, mockJurySC, project1.address, false)
      )
        .to.emit(registry, 'ProjectAuthorized')
        .withArgs(CHAIN_ID_TESTNET, mockJurySC, project1.address, false);
    });
  });

  describe('Gas Optimization Tests', function () {
    const mockJurySC = '0x837992aC7b89c148F7e42755816e74E84CF985AD';

    it('Should be gas efficient for batch operations vs individual calls', async function () {
      const projects = [project1.address, project2.address];

      const batchTx = await registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, mockJurySC, projects);
      const batchReceipt = await batchTx.wait();
      const batchGas = batchReceipt.gasUsed;

      const jurySC2 = '0x1234567890123456789012345678901234567890';
      const tx1 = await registry.setProjectAuthorization(CHAIN_ID_TESTNET, jurySC2, project1.address, true);
      const receipt1 = await tx1.wait();
      const tx2 = await registry.setProjectAuthorization(CHAIN_ID_TESTNET, jurySC2, project2.address, true);
      const receipt2 = await tx2.wait();
      const individualGas = receipt1.gasUsed + receipt2.gasUsed;

      expect(batchGas).to.be.lessThan(individualGas);
    });

    it('Should efficiently handle view function calls', async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySC, SAMPLE_CID);

      const gasEstimate = await registry.getIterationMetadata.estimateGas(CHAIN_ID_TESTNET, mockJurySC);
      expect(gasEstimate).to.be.lessThan(50000);
    });
  });

  describe('Integration Scenarios', function () {
    const iteration1 = '0x837992aC7b89c148F7e42755816e74E84CF985AD';
    const iteration2 = '0xafbdCDB66534cec38adec528892a452852E9B51e';

    it('Should handle complete iteration lifecycle', async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, iteration1, 'QmIteration1');
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, iteration1, project1.address, true);
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        iteration1,
        project1.address,
        'QmProject1Data'
      );

      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, iteration2, [iteration1]);

      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, iteration1)).to.equal('QmIteration1');
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, iteration1, project1.address))
        .to.equal('QmProject1Data');
      const prevRounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, iteration2);
      expect(prevRounds[0]).to.equal(iteration1);
    });

    it('Should handle multi-chain deployment scenario', async function () {
      const projects = [project1.address, project2.address];

      await registry.batchAuthorizeProjects(CHAIN_ID_TESTNET, iteration1, projects);
      await registry.batchAuthorizeProjects(CHAIN_ID_MAINNET, iteration1, projects);

      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        iteration1,
        project1.address,
        'QmTestnetData'
      );
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_MAINNET,
        iteration1,
        project1.address,
        'QmMainnetData'
      );

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, iteration1, project1.address))
        .to.equal('QmTestnetData');
      expect(await registry.getProjectMetadata(CHAIN_ID_MAINNET, iteration1, project1.address))
        .to.equal('QmMainnetData');
    });

    it('Should handle historical retroactive metadata addition', async function () {
      const oldIteration = '0x0000000000000000000000000000000000001337';

      await registry.setIterationMetadata(CHAIN_ID_MAINNET, oldIteration, 'QmHistoricalIteration');
      await registry.setProjectMetadata(
        CHAIN_ID_MAINNET,
        oldIteration,
        project1.address,
        'QmHistoricalProject'
      );

      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, oldIteration))
        .to.equal('QmHistoricalIteration');
      expect(await registry.getProjectMetadata(CHAIN_ID_MAINNET, oldIteration, project1.address))
        .to.equal('QmHistoricalProject');
    });

    it('Should handle complex previous rounds chain', async function () {
      const round1 = '0x0000000000000000000000000000000000001111';
      const round2 = '0x0000000000000000000000000000000000002222';
      const round3 = '0x0000000000000000000000000000000000003333';
      const currentRound = '0x0000000000000000000000000000000000004444';

      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, round2, [round1]);
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, round3, [round1, round2]);
      await registry.setPrevRoundContracts(CHAIN_ID_TESTNET, currentRound, [round1, round2, round3]);

      const prevRounds = await registry.getPrevRoundContracts(CHAIN_ID_TESTNET, currentRound);
      expect(prevRounds).to.have.lengthOf(3);
      expect(prevRounds[0]).to.equal(round1);
      expect(prevRounds[1]).to.equal(round2);
      expect(prevRounds[2]).to.equal(round3);
    });

    it('Should handle project participating across multiple iterations', async function () {
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, iteration1, project1.address, true);
      await registry.setProjectAuthorization(CHAIN_ID_TESTNET, iteration2, project1.address, true);

      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        iteration1,
        project1.address,
        'QmIter1Submission'
      );
      await registry.connect(project1).setProjectMetadata(
        CHAIN_ID_TESTNET,
        iteration2,
        project1.address,
        'QmIter2Submission'
      );

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, iteration1, project1.address))
        .to.equal('QmIter1Submission');
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, iteration2, project1.address))
        .to.equal('QmIter2Submission');
    });

    it('Should handle batch retrieval for multi-project iteration', async function () {
      const [, , , addr1, addr2, addr3] = await ethers.getSigners();
      const projects = [addr1.address, addr2.address, addr3.address];

      await registry.setProjectMetadata(CHAIN_ID_TESTNET, iteration1, addr1.address, 'QmProj1');
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, iteration1, addr2.address, 'QmProj2');
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, iteration1, addr3.address, 'QmProj3');

      const cids = await registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, iteration1, projects);
      expect(cids).to.deep.equal(['QmProj1', 'QmProj2', 'QmProj3']);
    });
  });
});
