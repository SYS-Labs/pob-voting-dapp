// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./PoB_01.sol";

/**
 * @title JurySC_01 - 3-Entity Voting System
 * @notice Manages project registration and 3-entity voting (DevRel, DAO_HIC, Community)
 * @dev Upgradeable via UUPS proxy pattern
 */
contract JurySC_01 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    uint256 public constant COMMUNITY_DEPOSIT = 30 ether; // 30 SYS

    // Core
    PoB_01 public pob;
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

    // Entity 1 - DevRel
    address public devRelAccount;
    address public devRelVote;
    bool public devRelHasVoted;

    // Entity 2 - DAO_HIC
    mapping(address => bool) public isDaoHicVoter;
    address[] public daoHicVoters;
    mapping(address => address) public daoHicVoteOf;
    mapping(address => bool) public daoHicHasVoted;
    uint256 public daoHicVotesCast;
    mapping(address => uint256) public daoHicProjectVotes;

    // Entity 3 - Community (NFT-based)
    mapping(uint256 => address) public communityVoteOf;
    mapping(uint256 => bool) public communityHasVoted;
    mapping(address => bool) public communityAccountHasVoted;
    uint256 public communityVotesCast;
    mapping(address => uint256) public communityProjectVotes;

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
    error NotDevRelAccount();
    error NotDaoHicVoter();
    error NoConsensus();
    error AlreadyClosed();

    // Events
    event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress);
    event ProjectRemoved(address indexed projectAddress);
    event DevRelAccountSet(address indexed account);
    event DaoHicVoterAdded(address indexed voter);
    event DaoHicVoterRemoved(address indexed voter);
    event Activated(uint64 startTime, uint64 endTime);
    event VotedDevRel(uint256 indexed projectId);
    event VotedDaoHic(address indexed voter, uint256 indexed projectId);
    event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId);
    event ContractLockedForHistory(address indexed winningProject);
    event ClosedManually(uint64 timestamp);

    /**
     * @notice Initialize the contract
     * @param pob_ PoB_01 NFT contract address
     * @param iteration_ Iteration number
     * @param initialOwner Initial owner address
     */
    function initialize(address payable pob_, uint256 iteration_, address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        pob = PoB_01(pob_);
        iteration = iteration_;
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

    /**
     * @notice Set/update DevRel voting account
     * @param account DevRel account address
     */
    function setDevRelAccount(address account) external onlyOwner {
        if (votingEnded()) revert ContractLocked();

        // If changed during voting, wipe previous vote
        if (devRelAccount != address(0) && devRelAccount != account) {
            devRelHasVoted = false;
            devRelVote = address(0);
        }

        devRelAccount = account;
        emit DevRelAccountSet(account);
    }

    /**
     * @notice Add DAO_HIC voter to pool
     * @param voter DAO_HIC voter address
     */
    function addDaoHicVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();

        if (!isDaoHicVoter[voter]) {
            isDaoHicVoter[voter] = true;
            daoHicVoters.push(voter);
            emit DaoHicVoterAdded(voter);
        }
    }

    /**
     * @notice Remove DAO_HIC voter from pool
     * @param voter DAO_HIC voter address
     */
    function removeDaoHicVoter(address voter) external onlyOwner {
        if (votingEnded()) revert ContractLocked();

        if (isDaoHicVoter[voter]) {
            if (daoHicHasVoted[voter]) {
                address previousVote = daoHicVoteOf[voter];
                if (previousVote != address(0) && daoHicProjectVotes[previousVote] > 0) {
                    daoHicProjectVotes[previousVote]--;
                }
                if (daoHicVotesCast > 0) {
                    daoHicVotesCast--;
                }
            }
            isDaoHicVoter[voter] = false;
            daoHicHasVoted[voter] = false;
            daoHicVoteOf[voter] = address(0);

            // Remove from array (swap and pop for gas efficiency)
            for (uint256 i = 0; i < daoHicVoters.length; i++) {
                if (daoHicVoters[i] == voter) {
                    daoHicVoters[i] = daoHicVoters[daoHicVoters.length - 1];
                    daoHicVoters.pop();
                    break;
                }
            }

            emit DaoHicVoterRemoved(voter);
        }
    }

    /**
     * @notice Activate voting window
     * @param startTime_ Voting start timestamp
     */
    function activate(uint64 startTime_) external onlyOwner {
        if (startTime != 0) revert AlreadyActivated();
        if (devRelAccount == address(0)) revert NotEnoughVoters();
        if (daoHicVoters.length < 1) revert NotEnoughVoters();
        if (projectCount < 1) revert InvalidProject();

        startTime = startTime_;
        endTime = startTime_ + 48 hours;
        projectsLocked = true;
        manuallyClosed = false;
        manualEndTime = 0;

        emit Activated(startTime, endTime);
    }

    /**
     * @notice Lock contract for history after winner determined
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
     * @dev Can lock even without consensus (tie/no majority is a valid final state)
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
     * @dev Voters can change their vote; tallies are updated incrementally
     * @param tokenId NFT token ID
     * @param project Project address to vote for
     */
    function voteCommunity(uint256 tokenId, address project) external {
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!isRegisteredProject[project]) revert InvalidProject();

        // Verify NFT ownership
        if (pob.ownerOf(tokenId) != msg.sender) revert NotOwner();

        // Verify NFT role
        if (keccak256(bytes(pob.getRoleOf(tokenId))) != keccak256(bytes("Community"))) {
            revert InvalidNFT();
        }

        // Handle vote change: decrement previous project's tally
        address previousVote = communityVoteOf[tokenId];
        if (previousVote != address(0) && communityProjectVotes[previousVote] > 0) {
            communityProjectVotes[previousVote]--;
        }

        // Only increment counters on first vote (not on vote change)
        if (!communityHasVoted[tokenId]) {
            communityVotesCast++;
            communityHasVoted[tokenId] = true;
            // Dual-check: prevent multi-NFT gaming (one vote per account)
            if (communityAccountHasVoted[msg.sender]) revert AlreadyVoted();
            communityAccountHasVoted[msg.sender] = true;
        }

        communityVoteOf[tokenId] = project;
        communityProjectVotes[project]++;

        emit VotedCommunity(tokenId, msg.sender, projectIdOf[project]);
    }

    /**
     * @notice DevRel voting (account-based)
     * @param project Project address to vote for
     */
    function voteDevRel(address project) external {
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (msg.sender != devRelAccount) revert NotDevRelAccount();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        devRelVote = project;
        devRelHasVoted = true;

        emit VotedDevRel(projectIdOf[project]);
    }

    /**
     * @notice DAO_HIC voting (account-based)
     * @param project Project address to vote for
     */
    function voteDaoHic(address project) external {
        if (!isActive()) revert NotActive();
        if (locked) revert ContractLocked();
        if (!isDaoHicVoter[msg.sender]) revert NotDaoHicVoter();
        if (!isRegisteredProject[project]) revert InvalidProject();
        if (isRegisteredProject[msg.sender]) revert ProjectCannotVote();

        address previousVote = daoHicVoteOf[msg.sender];
        if (previousVote != address(0) && daoHicProjectVotes[previousVote] > 0) {
            daoHicProjectVotes[previousVote]--;
        }

        if (!daoHicHasVoted[msg.sender]) {
            daoHicVotesCast++;
        }
        daoHicVoteOf[msg.sender] = project;
        daoHicHasVoted[msg.sender] = true;
        daoHicProjectVotes[project]++;

        emit VotedDaoHic(msg.sender, projectIdOf[project]);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Check if voting is currently active
     * @return bool True if voting is active
     */
    function isActive() public view returns (bool) {
        if (manuallyClosed) return false;
        return startTime != 0 && block.timestamp >= startTime && block.timestamp <= endTime;
    }

    /**
     * @notice Check if voting has ended
     * @return bool True if voting has ended
     */
    function votingEnded() public view returns (bool) {
        return startTime != 0 && (manuallyClosed || block.timestamp > endTime);
    }

    /**
     * @notice Alias for votingEnded() - used by PoB_01 minting logic
     */
    function hasVotingEnded() public view returns (bool) {
        return votingEnded();
    }

    /**
     * @notice Get registered NFT contract address
     * @return address PoB_01 address
     */
    function registeredNFT() public view returns (address) {
        return address(pob);
    }

    /**
     * @notice Check if account is DevRel
     * @param account Address to check
     * @return bool True if account is DevRel
     */
    function isDevRelAccount(address account) public view returns (bool) {
        return account == devRelAccount;
    }

    /**
     * @notice Get DevRel entity vote
     * @return projectId Project ID (0 if not voted)
     */
    function getDevRelEntityVote() public view returns (address) {
        return devRelHasVoted ? devRelVote : address(0);
    }

    /**
     * @notice Get DAO_HIC entity vote (majority vote among DAO_HIC voters)
     * @dev Optimized to use vote tallies instead of looping through voters
     * @return Winning project address (or address(0) if no votes or tie)
     */
    function getDaoHicEntityVote() public view returns (address) {
        if (projectCount == 0 || daoHicVotesCast == 0) return address(0);

        uint256 maxVotes = 0;
        uint256 winningId = 0;
        bool isTie = false;

        // Loop through projects (O(projectCount)) instead of voters (O(daoHicVoters.length))
        for (uint256 pid = 1; pid <= projectCount; pid++) {
            address project = projectAddress[pid];
            uint256 votes = daoHicProjectVotes[project];

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

    /**
     * @notice Get Community entity vote (majority vote among community NFT holders)
     * @dev CRITICAL OPTIMIZATION: Uses vote tallies instead of looping through ALL tokens
     *      Old implementation: O(nextId) - could be 100k+ iterations with many voters
     *      New implementation: O(projectCount) - typically <50 iterations
     *      Gas savings: ~3M gas with 1k voters, prevents hitting block gas limit
     * @return Winning project address (or address(0) if no votes or tie)
     */
    function getCommunityEntityVote() public view returns (address) {
        if (projectCount == 0 || communityVotesCast == 0) return address(0);

        uint256 maxVotes = 0;
        uint256 winningId = 0;
        bool isTie = false;

        // Loop through projects (O(projectCount)) instead of ALL tokens (O(nextId))
        // This scales with number of projects (~10-50) not number of voters (could be 100k+)
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

    /**
     * @notice Get winner (project with most entity votes)
     * @return winningProject Project address of winner
     * @return hasWinner True if clear winner exists
     */
    function getWinner() public view returns (address winningProject, bool hasWinner) {
        address devRelVote_ = getDevRelEntityVote();
        address daoHicVote = getDaoHicEntityVote();
        address communityVote = getCommunityEntityVote();

        if (projectCount == 0) {
            return (address(0), false);
        }

        uint256[] memory entityVotes = new uint256[](projectCount + 1);
        uint256 votingEntities = 0;

        if (devRelVote_ != address(0)) {
            uint256 pid = projectIdOf[devRelVote_];
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

    /**
     * @notice Get entity vote counts for transparency
     * @return entityVotes Array of [devRelVote, daoHicVote, communityVote]
     */
    function getEntityVoteCounts() public view returns (address[3] memory entityVotes) {
        entityVotes[0] = getDevRelEntityVote();
        entityVotes[1] = getDaoHicEntityVote();
        entityVotes[2] = getCommunityEntityVote();
    }

    /**
     * @notice Get list of DAO_HIC voters
     * @return address[] Array of DAO_HIC voter addresses
     */
    function getDaoHicVoters() public view returns (address[] memory) {
        return daoHicVoters;
    }

    /**
     * @notice Get vote participation counts
     * @return devRelCount 1 if DevRel has voted, 0 otherwise
     * @return daoHicCount Number of DAO_HIC voters who have voted
     * @return communityCount Number of Community tokens that have voted
     */
    function getVoteParticipationCounts() public view returns (
        uint256 devRelCount,
        uint256 daoHicCount,
        uint256 communityCount
    ) {
        devRelCount = devRelHasVoted ? 1 : 0;
        daoHicCount = daoHicVotesCast;
        communityCount = communityVotesCast;
    }

    /**
     * @notice Get per-project vote breakdown
     * @param project Project address
     * @return daoVotes Number of DAO_HIC votes for project
     * @return communityVotes Number of Community votes for project
     */
    function getProjectVoteBreakdown(address project) external view returns (
        uint256 daoVotes,
        uint256 communityVotes
    ) {
        daoVotes = daoHicProjectVotes[project];
        communityVotes = communityProjectVotes[project];
    }

    // ============================================
    // OWNERSHIP & UPGRADE AUTHORIZATION
    // ============================================

    /**
     * @notice Transfer ownership (blocked after contract is locked)
     * @param newOwner New owner address
     * @dev Ownership transfers are blocked after contract is locked for history
     */
    function transferOwnership(address newOwner) public override onlyOwner {
        if (locked) revert ContractLocked();
        super.transferOwnership(newOwner);
    }

    /**
     * @notice Renounce ownership (blocked after contract is locked)
     * @dev Ownership renunciation is blocked after contract is locked for history
     */
    function renounceOwnership() public override onlyOwner {
        if (locked) revert ContractLocked();
        super.renounceOwnership();
    }

    /**
     * @notice Authorize upgrade (owner only)
     * @dev Upgrades are blocked after contract is locked for history
     */
    function _authorizeUpgrade(address /* newImplementation */) internal view override onlyOwner {
        if (locked) revert ContractLocked();
    }
}
