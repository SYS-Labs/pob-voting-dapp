// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./PoB_04.sol";

/**
 * @title JurySC_04 - Latest PoB round contract with explicit migration support
 * @notice Keeps the current SMT + DAO_HIC + Community model and adds owner-gated import entrypoints.
 */
contract JurySC_04 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    uint256 public constant PRECISION = 1 ether;
    uint256 public constant ENTITY_WEIGHT = PRECISION / 3;
    uint256 public constant MAX_IMPORT_BATCH_SIZE = 100;
    uint64 public constant DEFAULT_VOTING_DURATION_HOURS = 48;
    uint64 public constant MAX_VOTING_DURATION_HOURS = type(uint64).max / 3600;

    enum VotingMode {
        CONSENSUS,
        WEIGHTED
    }

    struct VoterEntity {
        mapping(address => bool) isVoter;
        address[] voters;
        mapping(address => address) voteOf;
        mapping(address => bool) hasVoted;
        uint256 votesCast;
        mapping(address => uint256) projectVotes;
    }

    PoB_04 public pob;
    uint256 public iteration;
    uint64 public startTime;
    uint64 public endTime;
    bool public locked;
    bool public manuallyClosed;
    uint64 public manualEndTime;

    uint256 public projectCount;
    mapping(uint256 => address) public projectAddress;
    mapping(address => bool) public isRegisteredProject;
    mapping(address => uint256) public projectIdOf;
    bool public projectsLocked;

    VoterEntity private _smt;
    VoterEntity private _daoHic;

    mapping(uint256 => address) public communityVoteOf;
    mapping(uint256 => bool) public communityHasVoted;
    uint256 public communityVotesCast;
    mapping(address => uint256) public communityProjectVotes;

    VotingMode public votingMode;

    bool public migrationMode;
    bool public importedHistorySealed;
    bool public importedRoundStateSet;
    uint256 public importBatchCount;
    uint64 public votingDurationHours;

    error NotActive();
    error NotOwner();
    error AlreadyActivated();
    error InsufficientQuorum();
    error ProjectsLocked();
    error InvalidProject();
    error ContractLocked();
    error NotEnoughVoters();
    error AlreadyVoted();
    error InvalidNFT();
    error ProjectCannotVote();
    error NotSmtVoter();
    error NotDaoHicVoter();
    error NoConsensus();
    error AlreadyClosed();
    error UpgradesDuringVotingNotAllowed();
    error ProjectCannotBeSmt();
    error ProjectCannotBeDaoHic();
    error SmtCannotBeProject();
    error SmtCannotBeDaoHic();
    error SmtCannotBeCommunity();
    error DaoHicCannotBeSmt();
    error DaoHicCannotBeProject();
    error DaoHicCannotBeCommunity();
    error MigrationModeActive();
    error MigrationModeDisabled();
    error InvalidImportBatch();
    error InvalidImportEntity();
    error InvalidImportState();
    error ImportConflict();
    error ImportedHistoryAlreadySealed();
    error InvalidVotingModeValue();
    error InvalidVotingDurationHours();

    event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress);
    event ProjectRemoved(address indexed projectAddress);
    event SmtVoterAdded(address indexed voter);
    event SmtVoterRemoved(address indexed voter);
    event DaoHicVoterAdded(address indexed voter);
    event DaoHicVoterRemoved(address indexed voter);
    event Activated(uint64 startTime, uint64 endTime);
    event VotedSmt(address indexed voter, uint256 indexed projectId);
    event VotedDaoHic(address indexed voter, uint256 indexed projectId);
    event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId);
    event ContractLockedForHistory(address indexed winningProject);
    event ClosedManually(uint64 timestamp);
    event VotingModeChanged(VotingMode indexed oldMode, VotingMode indexed newMode);
    event VotingDurationChanged(uint64 oldDurationHours, uint64 newDurationHours);
    event MigrationModeEnabled(address indexed operator);
    event ImportedProjects(uint256 indexed iteration, address indexed jurySC, uint256 indexed batchId, uint256 count, string proofCid);
    event ImportedEntityVoters(uint256 indexed iteration, address indexed jurySC, uint256 indexed batchId, uint8 entityId, uint256 count, string proofCid);
    event ImportedEntityVotes(uint256 indexed iteration, address indexed jurySC, uint256 indexed batchId, uint8 entityId, uint256 count, string proofCid);
    event ImportedCommunityVotes(uint256 indexed iteration, address indexed jurySC, uint256 indexed batchId, uint256 count, string proofCid);
    event ImportedRoundState(
        uint256 indexed iteration,
        address indexed jurySC,
        uint256 indexed batchId,
        uint64 startTime,
        uint64 endTime,
        bool projectsLocked,
        bool locked,
        uint8 votingMode,
        string proofCid
    );
    event ImportedBadgeBatch(uint256 indexed iteration, address indexed pob, uint256 indexed batchId, uint256 count, string proofCid);
    event ImportedHistorySealed(address indexed jurySC, uint256 indexed iteration, uint256 indexed batchId, string proofCid);

    function initialize(address payable pob_, uint256 iteration_, address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        pob = PoB_04(pob_);
        iteration = iteration_;
        votingMode = VotingMode.CONSENSUS;
        votingDurationHours = DEFAULT_VOTING_DURATION_HOURS;
    }

    function _addVoter(VoterEntity storage e, address voter) internal {
        if (!e.isVoter[voter]) {
            e.isVoter[voter] = true;
            e.voters.push(voter);
        }
    }

    function _removeVoter(VoterEntity storage e, address voter) internal {
        if (e.isVoter[voter]) {
            if (e.hasVoted[voter]) {
                address prev = e.voteOf[voter];
                if (prev != address(0) && e.projectVotes[prev] > 0) {
                    e.projectVotes[prev]--;
                }
                if (e.votesCast > 0) {
                    e.votesCast--;
                }
            }
            e.isVoter[voter] = false;
            e.hasVoted[voter] = false;
            e.voteOf[voter] = address(0);

            for (uint256 i = 0; i < e.voters.length; i++) {
                if (e.voters[i] == voter) {
                    e.voters[i] = e.voters[e.voters.length - 1];
                    e.voters.pop();
                    break;
                }
            }
        }
    }

    function _vote(VoterEntity storage e, address project) internal {
        address prev = e.voteOf[msg.sender];
        if (prev != address(0) && e.projectVotes[prev] > 0) {
            e.projectVotes[prev]--;
        }
        if (!e.hasVoted[msg.sender]) {
            e.votesCast++;
        }
        e.voteOf[msg.sender] = project;
        e.hasVoted[msg.sender] = true;
        e.projectVotes[project]++;
    }

    function _getEntityVote(VoterEntity storage e) internal view returns (address) {
        if (projectCount == 0 || e.votesCast == 0) return address(0);

        uint256 maxVotes = 0;
        uint256 winningId = 0;
        bool isTie = false;

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            uint256 votes = e.projectVotes[projectAddress[pid]];
            if (votes > maxVotes) {
                maxVotes = votes;
                winningId = pid;
                isTie = false;
            } else if (votes == maxVotes && maxVotes > 0) {
                isTie = true;
            }
        }

        return isTie || winningId == 0 ? address(0) : projectAddress[winningId];
    }

    function _addWeightedScores(VoterEntity storage e, uint256[] memory scores) internal view {
        if (e.votesCast > 0) {
            for (uint256 pid = 1; pid <= projectCount; pid++) {
                uint256 votes = e.projectVotes[projectAddress[pid]];
                if (votes > 0) {
                    scores[pid] += (votes * ENTITY_WEIGHT) / e.votesCast;
                }
            }
        }
    }

    function _ensureNormalMode() internal view {
        if (migrationMode) revert MigrationModeActive();
    }

    function _ensureImportOpen(string calldata proofCid) internal view {
        if (!migrationMode) revert MigrationModeDisabled();
        if (importedHistorySealed) revert ImportedHistoryAlreadySealed();
        if (bytes(proofCid).length == 0) revert InvalidImportBatch();
    }

    function _nextImportBatchId() internal returns (uint256) {
        importBatchCount++;
        return importBatchCount;
    }

    function _importProject(address projectAddress_) internal {
        if (projectAddress_ == address(0)) revert InvalidProject();
        if (isRegisteredProject[projectAddress_]) {
            return;
        }
        if (_smt.isVoter[projectAddress_]) revert ProjectCannotBeSmt();
        if (_daoHic.isVoter[projectAddress_]) revert ProjectCannotBeDaoHic();

        projectCount++;
        projectAddress[projectCount] = projectAddress_;
        projectIdOf[projectAddress_] = projectCount;
        isRegisteredProject[projectAddress_] = true;
    }

    function _importEntityVoter(VoterEntity storage e, uint8 entityId, address voter) internal {
        if (voter == address(0)) revert InvalidImportBatch();

        if (entityId == 0) {
            if (isRegisteredProject[voter]) revert SmtCannotBeProject();
            if (_daoHic.isVoter[voter]) revert SmtCannotBeDaoHic();
        } else if (entityId == 1) {
            if (_smt.isVoter[voter]) revert DaoHicCannotBeSmt();
            if (isRegisteredProject[voter]) revert DaoHicCannotBeProject();
        } else {
            revert InvalidImportEntity();
        }

        _addVoter(e, voter);
    }

    function _importEntityVote(VoterEntity storage e, address voter, address project) internal {
        if (!e.isVoter[voter]) revert InvalidImportEntity();
        if (!isRegisteredProject[project]) revert InvalidProject();

        address prev = e.voteOf[voter];
        if (prev == address(0)) {
            if (e.hasVoted[voter]) revert ImportConflict();
            e.voteOf[voter] = project;
            e.hasVoted[voter] = true;
            e.votesCast++;
            e.projectVotes[project]++;
            return;
        }

        if (prev != project || !e.hasVoted[voter]) revert ImportConflict();
    }

    function _importCommunityVote(uint256 tokenId, address project) internal {
        if (!isRegisteredProject[project]) revert InvalidProject();

        address prev = communityVoteOf[tokenId];
        if (prev == address(0)) {
            if (communityHasVoted[tokenId]) revert ImportConflict();
            communityVoteOf[tokenId] = project;
            communityHasVoted[tokenId] = true;
            communityVotesCast++;
            communityProjectVotes[project]++;
            return;
        }

        if (prev != project || !communityHasVoted[tokenId]) revert ImportConflict();
    }

    function registerProject(address projectAddress_) external onlyOwner {
        _ensureNormalMode();
        if (projectsLocked) revert ProjectsLocked();
        if (projectAddress_ == address(0)) revert InvalidProject();
        if (isRegisteredProject[projectAddress_]) revert InvalidProject();
        if (_smt.isVoter[projectAddress_]) revert ProjectCannotBeSmt();
        if (_daoHic.isVoter[projectAddress_]) revert ProjectCannotBeDaoHic();

        projectCount++;
        projectAddress[projectCount] = projectAddress_;
        projectIdOf[projectAddress_] = projectCount;
        isRegisteredProject[projectAddress_] = true;

        emit ProjectRegistered(projectCount, projectAddress_);
    }

    function removeProject(address projectAddress_) external onlyOwner {
        _ensureNormalMode();
        if (projectsLocked) revert ProjectsLocked();
        uint256 projectId = projectIdOf[projectAddress_];
        if (projectId == 0) revert InvalidProject();

        uint256 lastProjectId = projectCount;
        if (projectId != lastProjectId) {
            address lastProjectAddress = projectAddress[lastProjectId];
            projectAddress[projectId] = lastProjectAddress;
            projectIdOf[lastProjectAddress] = projectId;
        }

        delete projectAddress[lastProjectId];
        projectIdOf[projectAddress_] = 0;
        isRegisteredProject[projectAddress_] = false;
        projectCount = lastProjectId - 1;

        emit ProjectRemoved(projectAddress_);
    }

    function addSmtVoter(address voter) external onlyOwner {
        _ensureNormalMode();
        if (votingEnded()) revert ContractLocked();
        if (isRegisteredProject[voter]) revert SmtCannotBeProject();
        if (_daoHic.isVoter[voter]) revert SmtCannotBeDaoHic();
        if (pob.hasMintedBadge(voter)) revert SmtCannotBeCommunity();
        _addVoter(_smt, voter);
        emit SmtVoterAdded(voter);
    }

    function removeSmtVoter(address voter) external onlyOwner {
        _ensureNormalMode();
        if (votingEnded()) revert ContractLocked();
        _removeVoter(_smt, voter);
        emit SmtVoterRemoved(voter);
    }

    function addDaoHicVoter(address voter) external onlyOwner {
        _ensureNormalMode();
        if (votingEnded()) revert ContractLocked();
        if (_smt.isVoter[voter]) revert DaoHicCannotBeSmt();
        if (isRegisteredProject[voter]) revert DaoHicCannotBeProject();
        if (pob.hasMintedBadge(voter)) revert DaoHicCannotBeCommunity();

        _addVoter(_daoHic, voter);
        emit DaoHicVoterAdded(voter);
    }

    function removeDaoHicVoter(address voter) external onlyOwner {
        _ensureNormalMode();
        if (votingEnded()) revert ContractLocked();
        _removeVoter(_daoHic, voter);
        emit DaoHicVoterRemoved(voter);
    }

    function setVotingMode(VotingMode mode_) external onlyOwner {
        _ensureNormalMode();
        if (startTime != 0) revert AlreadyActivated();
        VotingMode oldMode = votingMode;
        votingMode = mode_;
        emit VotingModeChanged(oldMode, mode_);
    }

    function setVotingDurationHours(uint64 durationHours_) external onlyOwner {
        _ensureNormalMode();
        if (startTime != 0) revert AlreadyActivated();
        if (durationHours_ == 0 || durationHours_ > MAX_VOTING_DURATION_HOURS) revert InvalidVotingDurationHours();

        uint64 oldDurationHours = votingDurationHours;
        votingDurationHours = durationHours_;
        emit VotingDurationChanged(oldDurationHours, durationHours_);
    }

    function enableMigrationMode() external onlyOwner {
        if (migrationMode) revert MigrationModeActive();
        if (startTime != 0) revert AlreadyActivated();
        if (locked) revert ContractLocked();
        migrationMode = true;
        emit MigrationModeEnabled(msg.sender);
    }

    function importProjectBatch(address[] calldata projects, string calldata proofCid) external onlyOwner {
        _ensureImportOpen(proofCid);
        uint256 length = projects.length;
        if (length == 0 || length > MAX_IMPORT_BATCH_SIZE) revert InvalidImportBatch();

        for (uint256 i = 0; i < length; i++) {
            _importProject(projects[i]);
        }

        uint256 batchId = _nextImportBatchId();
        emit ImportedProjects(iteration, address(this), batchId, length, proofCid);
    }

    function importEntityVoterBatch(uint8 entityId, address[] calldata voters, string calldata proofCid) external onlyOwner {
        _ensureImportOpen(proofCid);
        uint256 length = voters.length;
        if (length == 0 || length > MAX_IMPORT_BATCH_SIZE) revert InvalidImportBatch();

        VoterEntity storage entity = _entityForImport(entityId);
        for (uint256 i = 0; i < length; i++) {
            _importEntityVoter(entity, entityId, voters[i]);
        }

        uint256 batchId = _nextImportBatchId();
        emit ImportedEntityVoters(iteration, address(this), batchId, entityId, length, proofCid);
    }

    function importEntityVoteBatch(
        uint8 entityId,
        address[] calldata voters,
        address[] calldata projects,
        string calldata proofCid
    ) external onlyOwner {
        _ensureImportOpen(proofCid);
        uint256 length = voters.length;
        if (length == 0 || length > MAX_IMPORT_BATCH_SIZE || projects.length != length) revert InvalidImportBatch();

        VoterEntity storage entity = _entityForImport(entityId);
        for (uint256 i = 0; i < length; i++) {
            _importEntityVote(entity, voters[i], projects[i]);
        }

        uint256 batchId = _nextImportBatchId();
        emit ImportedEntityVotes(iteration, address(this), batchId, entityId, length, proofCid);
    }

    function importCommunityVoteBatch(
        uint256[] calldata tokenIds,
        address[] calldata projects,
        string calldata proofCid
    ) external onlyOwner {
        _ensureImportOpen(proofCid);
        uint256 length = tokenIds.length;
        if (length == 0 || length > MAX_IMPORT_BATCH_SIZE || projects.length != length) revert InvalidImportBatch();

        for (uint256 i = 0; i < length; i++) {
            _importCommunityVote(tokenIds[i], projects[i]);
        }

        uint256 batchId = _nextImportBatchId();
        emit ImportedCommunityVotes(iteration, address(this), batchId, length, proofCid);
    }

    function importRoundState(
        uint64 startTime_,
        uint64 endTime_,
        bool manuallyClosed_,
        uint64 manualEndTime_,
        bool projectsLocked_,
        bool locked_,
        uint8 votingMode_,
        string calldata proofCid
    ) external onlyOwner {
        _ensureImportOpen(proofCid);
        if (votingMode_ > uint8(VotingMode.WEIGHTED)) revert InvalidVotingModeValue();
        if (endTime_ < startTime_) revert InvalidImportState();
        if (manuallyClosed_ && manualEndTime_ == 0) revert InvalidImportState();

        if (importedRoundStateSet) {
            bool sameState = (
                startTime == startTime_ &&
                endTime == endTime_ &&
                manuallyClosed == manuallyClosed_ &&
                manualEndTime == manualEndTime_ &&
                projectsLocked == projectsLocked_ &&
                locked == locked_ &&
                uint8(votingMode) == votingMode_
            );
            if (!sameState) revert ImportConflict();
        } else {
            startTime = startTime_;
            endTime = endTime_;
            manuallyClosed = manuallyClosed_;
            manualEndTime = manualEndTime_;
            projectsLocked = projectsLocked_;
            locked = locked_;
            votingMode = VotingMode(votingMode_);
            importedRoundStateSet = true;
        }

        uint256 batchId = _nextImportBatchId();
        emit ImportedRoundState(iteration, address(this), batchId, startTime_, endTime_, projectsLocked_, locked_, votingMode_, proofCid);
    }

    function importBadgeBatch(
        uint256[] calldata tokenIds,
        address[] calldata owners,
        string[] calldata roles,
        bool[] calldata claimedFlags,
        string calldata proofCid
    ) external onlyOwner {
        _ensureImportOpen(proofCid);
        pob.importBadgeBatchFromJury(tokenIds, owners, roles, claimedFlags);
        uint256 batchId = _nextImportBatchId();
        emit ImportedBadgeBatch(iteration, address(pob), batchId, tokenIds.length, proofCid);
    }

    function sealImportedHistory(string calldata proofCid) external onlyOwner {
        _ensureImportOpen(proofCid);
        if (!importedRoundStateSet) revert InvalidImportState();

        importedHistorySealed = true;
        locked = true;
        projectsLocked = true;
        pob.sealImportedHistory();

        uint256 batchId = _nextImportBatchId();
        emit ImportedHistorySealed(address(this), iteration, batchId, proofCid);
    }

    function setCommunityDonationRecipient(address payable newRecipient) external onlyOwner {
        pob.setCommunityDonationRecipient(newRecipient);
    }

    function activate() external onlyOwner {
        _ensureNormalMode();
        if (startTime != 0) revert AlreadyActivated();
        if (_smt.voters.length < 1) revert NotEnoughVoters();
        if (_daoHic.voters.length < 1) revert NotEnoughVoters();
        if (projectCount < 1) revert InvalidProject();

        startTime = uint64(block.timestamp);
        uint64 durationHours = votingDurationHours == 0 ? DEFAULT_VOTING_DURATION_HOURS : votingDurationHours;
        uint256 computedEndTime = uint256(startTime) + (uint256(durationHours) * 1 hours);
        if (computedEndTime > type(uint64).max) revert InvalidVotingDurationHours();
        endTime = uint64(computedEndTime);
        projectsLocked = true;
        manuallyClosed = false;
        manualEndTime = 0;

        emit Activated(startTime, endTime);
    }

    function closeManually() external onlyOwner {
        _ensureNormalMode();
        if (locked) revert ContractLocked();
        if (manuallyClosed) revert AlreadyClosed();
        if (!isActive()) revert NotActive();

        manuallyClosed = true;
        manualEndTime = uint64(block.timestamp);
        if (manualEndTime < endTime) {
            endTime = manualEndTime;
        }

        emit ClosedManually(manualEndTime);
    }

    function lockContractForHistory() external onlyOwner {
        _ensureNormalMode();
        if (!votingEnded()) revert NotActive();

        (address winningProject, ) = getWinner();

        locked = true;
        emit ContractLockedForHistory(winningProject);
    }

    function voteCommunity(uint256 tokenId, address project) external {
        _ensureNormalMode();
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        if (pob.ownerOf(tokenId) != msg.sender) revert NotOwner();

        if (keccak256(bytes(pob.getRoleOf(tokenId))) != keccak256(bytes("Community"))) {
            revert InvalidNFT();
        }

        address previousVote = communityVoteOf[tokenId];
        if (previousVote != address(0) && communityProjectVotes[previousVote] > 0) {
            communityProjectVotes[previousVote]--;
        }

        if (!communityHasVoted[tokenId]) {
            communityVotesCast++;
            communityHasVoted[tokenId] = true;
        }

        communityVoteOf[tokenId] = project;
        communityProjectVotes[project]++;

        emit VotedCommunity(tokenId, msg.sender, projectIdOf[project]);
    }

    function voteSmt(address project) external {
        _ensureNormalMode();
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!_smt.isVoter[msg.sender]) revert NotSmtVoter();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        _vote(_smt, project);
        emit VotedSmt(msg.sender, projectIdOf[project]);
    }

    function voteDaoHic(address project) external {
        _ensureNormalMode();
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!_daoHic.isVoter[msg.sender]) revert NotDaoHicVoter();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        _vote(_daoHic, project);
        emit VotedDaoHic(msg.sender, projectIdOf[project]);
    }

    function isActive() public view returns (bool) {
        if (manuallyClosed) return false;
        return startTime != 0 && block.timestamp >= startTime && block.timestamp <= endTime;
    }

    function votingEnded() public view returns (bool) {
        return startTime != 0 && (manuallyClosed || block.timestamp > endTime);
    }

    function hasVotingEnded() public view returns (bool) {
        return votingEnded();
    }

    function registeredNFT() public view returns (address) {
        return address(pob);
    }

    function isSmtVoter(address a) public view returns (bool) {
        return _smt.isVoter[a];
    }

    function smtVoteOf(address a) public view returns (address) {
        return _smt.voteOf[a];
    }

    function smtHasVoted(address a) public view returns (bool) {
        return _smt.hasVoted[a];
    }

    function getSmtVoters() public view returns (address[] memory) {
        return _smt.voters;
    }

    function getSmtEntityVote() public view returns (address) {
        return _getEntityVote(_smt);
    }

    function isDaoHicVoter(address a) public view returns (bool) {
        return _daoHic.isVoter[a];
    }

    function daoHicVoteOf(address a) public view returns (address) {
        return _daoHic.voteOf[a];
    }

    function daoHicHasVoted(address a) public view returns (bool) {
        return _daoHic.hasVoted[a];
    }

    function getDaoHicVoters() public view returns (address[] memory) {
        return _daoHic.voters;
    }

    function getDaoHicEntityVote() public view returns (address) {
        return _getEntityVote(_daoHic);
    }

    function getCommunityEntityVote() public view returns (address) {
        if (projectCount == 0 || communityVotesCast == 0) return address(0);

        uint256 maxVotes = 0;
        uint256 winningId = 0;
        bool isTie = false;

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            address project = projectAddress[pid];
            uint256 votes = communityProjectVotes[project];

            if (votes > maxVotes) {
                maxVotes = votes;
                winningId = pid;
                isTie = false;
            } else if (votes == maxVotes && maxVotes > 0) {
                isTie = true;
            }
        }

        return isTie || winningId == 0 ? address(0) : projectAddress[winningId];
    }

    function getWinnerConsensus() public view returns (address winningProject, bool hasWinner) {
        address smtVote = getSmtEntityVote();
        address daoHicVote = getDaoHicEntityVote();
        address communityVote = getCommunityEntityVote();

        if (projectCount == 0) {
            return (address(0), false);
        }

        uint256[] memory entityVotes = new uint256[](projectCount + 1);
        uint256 votingEntities = 0;

        if (smtVote != address(0)) {
            uint256 pid = projectIdOf[smtVote];
            if (pid != 0) {
                entityVotes[pid]++;
                votingEntities++;
            }
        }
        if (daoHicVote != address(0)) {
            uint256 pid = projectIdOf[daoHicVote];
            if (pid != 0) {
                entityVotes[pid]++;
                votingEntities++;
            }
        }
        if (communityVote != address(0)) {
            uint256 pid = projectIdOf[communityVote];
            if (pid != 0) {
                entityVotes[pid]++;
                votingEntities++;
            }
        }

        if (votingEntities == 0) {
            return (address(0), false);
        }

        uint256 maxEntityVotes = 0;
        uint256 winnerId = 0;
        bool isTie = false;

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            if (entityVotes[pid] > maxEntityVotes) {
                maxEntityVotes = entityVotes[pid];
                winnerId = pid;
                isTie = false;
            } else if (entityVotes[pid] == maxEntityVotes && maxEntityVotes > 0) {
                isTie = true;
            }
        }

        if (isTie || winnerId == 0) {
            return (address(0), false);
        }

        return (projectAddress[winnerId], true);
    }

    function getWinnerWeighted() public view returns (address winningProject, bool hasWinner) {
        if (projectCount == 0) {
            return (address(0), false);
        }

        uint256[] memory scores = new uint256[](projectCount + 1);

        _addWeightedScores(_smt, scores);
        _addWeightedScores(_daoHic, scores);

        if (communityVotesCast > 0) {
            for (uint256 pid = 1; pid <= projectCount; pid++) {
                address project = projectAddress[pid];
                uint256 votes = communityProjectVotes[project];
                if (votes > 0) {
                    scores[pid] += (votes * ENTITY_WEIGHT) / communityVotesCast;
                }
            }
        }

        uint256 maxScore = 0;
        uint256 winnerId = 0;
        bool isTie = false;

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            if (scores[pid] > maxScore) {
                maxScore = scores[pid];
                winnerId = pid;
                isTie = false;
            } else if (scores[pid] == maxScore && maxScore > 0) {
                isTie = true;
            }
        }

        if (winnerId == 0 || maxScore == 0 || isTie) {
            return (address(0), false);
        }

        return (projectAddress[winnerId], true);
    }

    function getWinnerWithScores() public view returns (
        address[] memory projectAddresses,
        uint256[] memory scores,
        uint256 totalPossibleScore
    ) {
        projectAddresses = new address[](projectCount);
        scores = new uint256[](projectCount);
        totalPossibleScore = PRECISION;

        if (projectCount == 0) {
            return (projectAddresses, scores, totalPossibleScore);
        }

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            address project = projectAddress[pid];
            projectAddresses[pid - 1] = project;
            uint256 score = 0;

            if (_smt.votesCast > 0) {
                uint256 smtVotes = _smt.projectVotes[project];
                if (smtVotes > 0) {
                    score += (smtVotes * ENTITY_WEIGHT) / _smt.votesCast;
                }
            }

            if (_daoHic.votesCast > 0) {
                uint256 daoVotes = _daoHic.projectVotes[project];
                if (daoVotes > 0) {
                    score += (daoVotes * ENTITY_WEIGHT) / _daoHic.votesCast;
                }
            }

            if (communityVotesCast > 0) {
                uint256 commVotes = communityProjectVotes[project];
                if (commVotes > 0) {
                    score += (commVotes * ENTITY_WEIGHT) / communityVotesCast;
                }
            }

            scores[pid - 1] = score;
        }

        return (projectAddresses, scores, totalPossibleScore);
    }

    function getWinner() public view returns (address winningProject, bool hasWinner) {
        if (votingMode == VotingMode.CONSENSUS) {
            return getWinnerConsensus();
        }
        return getWinnerWeighted();
    }

    function getEntityVoteCounts() public view returns (address[3] memory entityVotes) {
        entityVotes[0] = getSmtEntityVote();
        entityVotes[1] = getDaoHicEntityVote();
        entityVotes[2] = getCommunityEntityVote();
    }

    function getVoteParticipationCounts() public view returns (
        uint256 smtCount,
        uint256 daoHicCount,
        uint256 communityCount
    ) {
        smtCount = _smt.votesCast;
        daoHicCount = _daoHic.votesCast;
        communityCount = communityVotesCast;
    }

    function getProjectVoteBreakdown(address project) external view returns (
        uint256 smtVotes,
        uint256 daoVotes,
        uint256 communityVotes
    ) {
        smtVotes = _smt.projectVotes[project];
        daoVotes = _daoHic.projectVotes[project];
        communityVotes = communityProjectVotes[project];
    }

    function getProjectAddresses() external view returns (address[] memory) {
        address[] memory addresses = new address[](projectCount);
        for (uint256 i = 1; i <= projectCount; i++) {
            addresses[i - 1] = projectAddress[i];
        }
        return addresses;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (locked) revert ContractLocked();
        super.transferOwnership(newOwner);
    }

    function renounceOwnership() public override onlyOwner {
        if (locked) revert ContractLocked();
        super.renounceOwnership();
    }

    function _authorizeUpgrade(address /* newImplementation */) internal view override onlyOwner {
        if (locked) revert ContractLocked();
        if (startTime != 0 && !migrationMode) revert UpgradesDuringVotingNotAllowed();
    }

    function _entityForImport(uint8 entityId) internal view returns (VoterEntity storage) {
        if (entityId == 0) {
            return _smt;
        }
        if (entityId == 1) {
            return _daoHic;
        }
        revert InvalidImportEntity();
    }
}
