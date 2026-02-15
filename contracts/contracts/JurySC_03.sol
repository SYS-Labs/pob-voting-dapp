// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./PoB_03.sol";

/**
 * @title JurySC_03 - 3-Entity Voting System (SMT + DAO_HIC + Community)
 * @notice Manages project registration and 3-entity voting
 * @dev Upgradeable via UUPS proxy pattern. Replaces DevRel with SMT multi-voter entity.
 *      SMT and DAO_HIC share identical mechanics via generic VoterEntity struct.
 */
contract JurySC_03 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    uint256 public constant COMMUNITY_DEPOSIT = 30 ether; // 30 SYS
    uint256 public constant PRECISION = 1 ether; // 1e18
    uint256 public constant ENTITY_WEIGHT = PRECISION / 3; // Each entity worth 1/3

    // Voting modes
    enum VotingMode {
        CONSENSUS,  // Entity majority required
        WEIGHTED    // Proportional vote-weighted scoring
    }

    // Generic voter entity - used for both SMT and DAO_HIC
    struct VoterEntity {
        mapping(address => bool) isVoter;
        address[] voters;
        mapping(address => address) voteOf;
        mapping(address => bool) hasVoted;
        uint256 votesCast;
        mapping(address => uint256) projectVotes;
    }

    // Core
    PoB_03 public pob;
    uint256 public iteration;
    uint64 public startTime;
    uint64 public endTime;
    bool public locked;
    bool public manuallyClosed;
    uint64 public manualEndTime;

    // Projects
    uint256 public projectCount;
    mapping(uint256 => address) public projectAddress; // 1-indexed
    mapping(address => bool) public isRegisteredProject;
    mapping(address => uint256) public projectIdOf; // 1-indexed, 0 if not registered
    bool public projectsLocked;

    // Entity 1 - SMT (multi-voter, replaces DevRel)
    VoterEntity private _smt;

    // Entity 2 - DAO_HIC (multi-voter)
    VoterEntity private _daoHic;

    // Entity 3 - Community (NFT-based)
    mapping(uint256 => address) public communityVoteOf;
    mapping(uint256 => bool) public communityHasVoted;
    uint256 public communityVotesCast;
    mapping(address => uint256) public communityProjectVotes;

    // Voting mode
    VotingMode public votingMode;

    // Errors
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
    // Role isolation errors
    error ProjectCannotBeSmt();
    error ProjectCannotBeDaoHic();
    error SmtCannotBeProject();
    error SmtCannotBeDaoHic();
    error SmtCannotBeCommunity();
    error DaoHicCannotBeSmt();
    error DaoHicCannotBeProject();
    error DaoHicCannotBeCommunity();

    // Events
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

    /**
     * @notice Initialize the contract
     * @param pob_ PoB_03 NFT contract address
     * @param iteration_ Iteration number
     * @param initialOwner Initial owner address
     */
    function initialize(address payable pob_, uint256 iteration_, address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        pob = PoB_03(pob_);
        iteration = iteration_;
        votingMode = VotingMode.CONSENSUS;
    }

    // ============================================
    // INTERNAL HELPERS (shared VoterEntity logic)
    // ============================================

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

            // Swap-and-pop removal from voters array
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

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Register a new project (voting option)
     * @param projectAddress_ Project account address
     */
    function registerProject(address projectAddress_) external onlyOwner {
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

    /**
     * @notice Remove a project before activation
     * @param projectAddress_ Project account address to remove
     */
    function removeProject(address projectAddress_) external onlyOwner {
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

    // --- SMT voter management ---

    /**
     * @notice Add SMT voter to pool
     * @param voter SMT voter address
     */
    function addSmtVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();
        if (isRegisteredProject[voter]) revert SmtCannotBeProject();
        if (_daoHic.isVoter[voter]) revert SmtCannotBeDaoHic();
        if (pob.hasMintedBadge(voter)) revert SmtCannotBeCommunity();
        _addVoter(_smt, voter);
        emit SmtVoterAdded(voter);
    }

    /**
     * @notice Remove SMT voter from pool
     * @param voter SMT voter address
     */
    function removeSmtVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();
        _removeVoter(_smt, voter);
        emit SmtVoterRemoved(voter);
    }

    // --- DAO_HIC voter management ---

    /**
     * @notice Add DAO_HIC voter to pool
     * @param voter DAO_HIC voter address
     */
    function addDaoHicVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();
        if (_smt.isVoter[voter]) revert DaoHicCannotBeSmt();
        if (isRegisteredProject[voter]) revert DaoHicCannotBeProject();
        if (pob.hasMintedBadge(voter)) revert DaoHicCannotBeCommunity();

        _addVoter(_daoHic, voter);
        emit DaoHicVoterAdded(voter);
    }

    /**
     * @notice Remove DAO_HIC voter from pool
     * @param voter DAO_HIC voter address
     */
    function removeDaoHicVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();
        _removeVoter(_daoHic, voter);
        emit DaoHicVoterRemoved(voter);
    }

    /**
     * @notice Set voting mode (CONSENSUS or WEIGHTED)
     * @param mode_ The voting mode to use for determining winner
     * @dev Can only be changed before voting starts (startTime == 0)
     */
    function setVotingMode(VotingMode mode_) external onlyOwner {
        if (startTime != 0) revert AlreadyActivated();
        VotingMode oldMode = votingMode;
        votingMode = mode_;
        emit VotingModeChanged(oldMode, mode_);
    }

    /**
     * @notice Activate voting window (starts immediately)
     * @dev Voting starts at current block timestamp and lasts 48 hours
     */
    function activate() external onlyOwner {
        if (startTime != 0) revert AlreadyActivated();
        if (_smt.voters.length < 1) revert NotEnoughVoters();
        if (_daoHic.voters.length < 1) revert NotEnoughVoters();
        if (projectCount < 1) revert InvalidProject();

        startTime = uint64(block.timestamp);
        endTime = startTime + 48 hours;
        projectsLocked = true;
        manuallyClosed = false;
        manualEndTime = 0;

        emit Activated(startTime, endTime);
    }

    /**
     * @notice Close voting manually
     */
    function closeManually() external onlyOwner {
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

    /**
     * @notice Lock contract for history after voting ends
     */
    function lockContractForHistory() external onlyOwner {
        if (!votingEnded()) revert NotActive();

        (address winningProject, ) = getWinner();

        locked = true;
        emit ContractLockedForHistory(winningProject);
    }

    // ============================================
    // VOTING FUNCTIONS
    // ============================================

    /**
     * @notice Community voting (NFT-based with dual-check)
     * @param tokenId NFT token ID
     * @param project Project address to vote for
     */
    function voteCommunity(uint256 tokenId, address project) external {
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

    /**
     * @notice SMT voting (multi-voter entity)
     * @param project Project address to vote for
     */
    function voteSmt(address project) external {
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!_smt.isVoter[msg.sender]) revert NotSmtVoter();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        _vote(_smt, project);
        emit VotedSmt(msg.sender, projectIdOf[project]);
    }

    /**
     * @notice DAO_HIC voting (multi-voter entity)
     * @param project Project address to vote for
     */
    function voteDaoHic(address project) external {
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!_daoHic.isVoter[msg.sender]) revert NotDaoHicVoter();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        _vote(_daoHic, project);
        emit VotedDaoHic(msg.sender, projectIdOf[project]);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

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

    // --- SMT getters ---

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

    // --- DAO_HIC getters ---

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

    // --- Community getters ---

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

    // --- Winner determination ---

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

        uint256[] memory scores = new uint256[](projectCount + 1); // 1-indexed

        // SMT entity: Proportional based on vote distribution
        _addWeightedScores(_smt, scores);

        // DAO HIC entity: Proportional based on vote distribution
        _addWeightedScores(_daoHic, scores);

        // Community entity: Proportional based on vote distribution
        if (communityVotesCast > 0) {
            for (uint256 pid = 1; pid <= projectCount; pid++) {
                address project = projectAddress[pid];
                uint256 votes = communityProjectVotes[project];
                if (votes > 0) {
                    scores[pid] += (votes * ENTITY_WEIGHT) / communityVotesCast;
                }
            }
        }

        // Find project with highest score
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
        totalPossibleScore = PRECISION; // 3 * ENTITY_WEIGHT = 1e18

        if (projectCount == 0) {
            return (projectAddresses, scores, totalPossibleScore);
        }

        for (uint256 pid = 1; pid <= projectCount; pid++) {
            address project = projectAddress[pid];
            projectAddresses[pid - 1] = project;
            uint256 score = 0;

            // SMT contribution (proportional)
            if (_smt.votesCast > 0) {
                uint256 smtVotes = _smt.projectVotes[project];
                if (smtVotes > 0) {
                    score += (smtVotes * ENTITY_WEIGHT) / _smt.votesCast;
                }
            }

            // DAO HIC contribution (proportional)
            if (_daoHic.votesCast > 0) {
                uint256 daoVotes = _daoHic.projectVotes[project];
                if (daoVotes > 0) {
                    score += (daoVotes * ENTITY_WEIGHT) / _daoHic.votesCast;
                }
            }

            // Community contribution (proportional)
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
        } else {
            return getWinnerWeighted();
        }
    }

    /**
     * @notice Get entity vote counts for transparency
     * @return entityVotes Array of [smtVote, daoHicVote, communityVote]
     */
    function getEntityVoteCounts() public view returns (address[3] memory entityVotes) {
        entityVotes[0] = getSmtEntityVote();
        entityVotes[1] = getDaoHicEntityVote();
        entityVotes[2] = getCommunityEntityVote();
    }

    /**
     * @notice Get vote participation counts
     * @return smtCount Number of SMT voters who have voted
     * @return daoHicCount Number of DAO_HIC voters who have voted
     * @return communityCount Number of Community tokens that have voted
     */
    function getVoteParticipationCounts() public view returns (
        uint256 smtCount,
        uint256 daoHicCount,
        uint256 communityCount
    ) {
        smtCount = _smt.votesCast;
        daoHicCount = _daoHic.votesCast;
        communityCount = communityVotesCast;
    }

    /**
     * @notice Get per-project vote breakdown
     * @param project Project address
     * @return smtVotes Number of SMT votes for project
     * @return daoVotes Number of DAO_HIC votes for project
     * @return communityVotes Number of Community votes for project
     */
    function getProjectVoteBreakdown(address project) external view returns (
        uint256 smtVotes,
        uint256 daoVotes,
        uint256 communityVotes
    ) {
        smtVotes = _smt.projectVotes[project];
        daoVotes = _daoHic.projectVotes[project];
        communityVotes = communityProjectVotes[project];
    }

    /**
     * @notice Get all registered project addresses
     */
    function getProjectAddresses() external view returns (address[] memory) {
        address[] memory addresses = new address[](projectCount);
        for (uint256 i = 1; i <= projectCount; i++) {
            addresses[i - 1] = projectAddress[i];
        }
        return addresses;
    }

    // ============================================
    // OWNERSHIP & UPGRADE AUTHORIZATION
    // ============================================

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
        if (startTime != 0) revert UpgradesDuringVotingNotAllowed();
    }
}
