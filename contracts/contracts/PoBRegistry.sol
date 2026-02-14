// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title IJurySC
 * @notice Interface for querying JurySC contract state
 */
interface IJurySC {
    function isRegisteredProject(address projectAddress) external view returns (bool);
    function projectsLocked() external view returns (bool);
    function locked() external view returns (bool);
    function pob() external view returns (address);
}

/**
 * @title PoBRegistry
 * @notice Centralized registry for IPFS metadata CIDs across all Proof-of-Builders iterations, rounds, and projects
 * @dev This contract serves as the single source of truth for metadata CIDs, allowing:
 *      - Historical iterations/rounds to have IPFS metadata (retroactive)
 *      - Projects to manage their own metadata
 *      - Unified metadata retrieval across all contract versions
 */
contract PoBRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    // ========== Constants ==========

    /// @notice Maximum batch size for batch operations
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice Maximum length for CID strings
    uint256 public constant MAX_CID_LENGTH = 100;

    /// @notice Maximum number of rounds per iteration
    uint256 public constant MAX_ROUNDS_PER_ITERATION = 100;

    // ========== Structs ==========

    /// @notice Information about an iteration
    struct IterationInfo {
        uint256 iterationId;      // Iteration number (1, 2, 3, ...)
        uint256 chainId;          // Network chain ID (57, 5700, 31337)
        uint256 roundCount;       // Number of rounds in this iteration
        bool exists;              // Flag to check if iteration is registered
    }

    /// @notice Information about a round within an iteration
    struct RoundInfo {
        uint256 iterationId;      // Parent iteration ID
        uint256 roundId;          // Round number within iteration (1, 2, 3, ...)
        address jurySC;           // JurySC_01 contract address
        uint256 deployBlockHint;  // Block number hint for event queries (optimization)
        bool exists;              // Flag to check if round is registered
    }

    /// @notice Reference to find iteration/round by contract address
    struct RoundRef {
        uint256 iterationId;
        uint256 roundId;
        bool exists;
    }

    // ========== State Variables ==========

    /// @notice Metadata CID for an iteration
    /// @dev Mapping: chainId => jurySCAddress => CID
    mapping(uint256 => mapping(address => string)) public iterationMetadata;

    /// @notice Metadata CID for a project within a round
    /// @dev Mapping: chainId => jurySCAddress => projectAddress => CID
    mapping(uint256 => mapping(address => mapping(address => string))) public projectMetadata;

    /// @notice Registry of all iterations
    /// @dev Mapping: iterationId => IterationInfo
    mapping(uint256 => IterationInfo) public iterations;

    /// @notice Registry of all rounds within each iteration
    /// @dev Mapping: iterationId => roundId => RoundInfo
    mapping(uint256 => mapping(uint256 => RoundInfo)) public rounds;

    /// @notice Reverse lookup: contract address => iteration/round reference
    /// @dev Mapping: chainId => jurySC => RoundRef
    mapping(uint256 => mapping(address => RoundRef)) public roundByContract;

    /// @notice Total number of registered iterations
    uint256 public iterationCount;

    /// @notice Flag indicating if registry initialization is complete
    /// @dev During initialization (false), owner can set any project metadata
    /// @dev After initialization (true), only authorized projects can set their own metadata
    bool public initializationComplete;

    // ========== Profile Storage (v2) ==========

    /// @notice Profile picture CID for an address
    mapping(address => string) public profilePictureCID;

    /// @notice Profile bio CID for an address
    mapping(address => string) public profileBioCID;

    // ========== Adapter Routing (v3) ==========

    /// @notice Version ID => adapter contract address
    mapping(uint256 => address) public versionAdapters;

    /// @notice Iteration ID => round ID => version number
    mapping(uint256 => mapping(uint256 => uint256)) public roundVersion;

    // ========== Events ==========

    event IterationRegistered(
        uint256 indexed iterationId,
        uint256 indexed chainId
    );

    event RoundAdded(
        uint256 indexed iterationId,
        uint256 indexed roundId,
        address indexed jurySC,
        address pob,
        uint256 chainId
    );

    event IterationMetadataSet(
        uint256 indexed chainId,
        address indexed jurySC,
        string cid,
        address indexed setter
    );

    event ProjectMetadataSet(
        uint256 indexed chainId,
        address indexed jurySC,
        address indexed projectAddress,
        string cid,
        address setter
    );

    event InitializationCompleted(
        address indexed completedBy,
        uint256 timestamp
    );

    event ProfilePictureSet(address indexed account, string cid);
    event ProfileBioSet(address indexed account, string cid);

    event AdapterSet(uint256 indexed versionId, address indexed adapter);
    event RoundVersionSet(uint256 indexed iterationId, uint256 indexed roundId, uint256 indexed versionId);

    // ========== Initialization ==========

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        initializationComplete = false; // Start in initialization mode
    }

    /**
     * @notice Complete initialization phase (owner only)
     * @dev After this is called, owner can no longer set project metadata for other projects
     * @dev Projects can only manage their own metadata if authorized
     */
    function completeInitialization() external onlyOwner {
        require(!initializationComplete, "Initialization already complete");
        initializationComplete = true;
        emit InitializationCompleted(msg.sender, block.timestamp);
    }

    // ========== Admin Functions - Iteration/Round Registry ==========

    /**
     * @notice Register a new iteration (owner only)
     * @dev Name is stored in PoB NFT contract and IPFS metadata, not duplicated here
     * @param iterationId Iteration number (1, 2, 3, ...)
     * @param chainId Chain ID (57, 5700, 31337)
     */
    function registerIteration(
        uint256 iterationId,
        uint256 chainId
    ) external onlyOwner {
        require(iterationId > 0, "Invalid iteration ID");
        require(chainId > 0, "Invalid chain ID");
        require(!iterations[iterationId].exists, "Iteration already registered");

        iterations[iterationId] = IterationInfo({
            iterationId: iterationId,
            chainId: chainId,
            roundCount: 0,
            exists: true
        });

        iterationCount++;
        emit IterationRegistered(iterationId, chainId);
    }

    /**
     * @notice Add a round to an iteration (owner only)
     * @param iterationId Parent iteration ID
     * @param roundId Round number within iteration (1, 2, 3, ...)
     * @param jurySC JurySC_01 contract address
     * @param deployBlockHint Block number hint for event queries (optimization)
     */
    function addRound(
        uint256 iterationId,
        uint256 roundId,
        address jurySC,
        uint256 deployBlockHint
    ) external onlyOwner {
        require(iterations[iterationId].exists, "Iteration not registered");
        require(roundId > 0, "Invalid round ID");
        require(jurySC != address(0), "Invalid jurySC address");
        require(!rounds[iterationId][roundId].exists, "Round already exists");

        // Use iteration's chainId for roundByContract lookup
        uint256 chainId = iterations[iterationId].chainId;
        require(!roundByContract[chainId][jurySC].exists, "JurySC already registered");
        require(
            iterations[iterationId].roundCount < MAX_ROUNDS_PER_ITERATION,
            "Max rounds reached"
        );

        rounds[iterationId][roundId] = RoundInfo({
            iterationId: iterationId,
            roundId: roundId,
            jurySC: jurySC,
            deployBlockHint: deployBlockHint,
            exists: true
        });

        roundByContract[chainId][jurySC] = RoundRef({
            iterationId: iterationId,
            roundId: roundId,
            exists: true
        });

        iterations[iterationId].roundCount++;

        // Query PoB from JurySC for event emission
        address pob = address(0);
        try IJurySC(jurySC).pob() returns (address pobAddress) {
            pob = pobAddress;
        } catch {
            // If query fails, emit with zero address
        }

        emit RoundAdded(iterationId, roundId, jurySC, pob, chainId);
    }

    // ========== Admin Functions - Metadata ==========

    /**
     * @notice Set iteration metadata CID (owner only)
     * @dev During initialization: Owner can set metadata for any iteration (including historical/locked ones)
     * @dev After initialization: Cannot update metadata if JurySC is locked for history
     * @param chainId Chain ID (57 for mainnet, 5700 for testnet)
     * @param jurySC JurySC contract address for this iteration
     * @param cid IPFS CID for iteration metadata
     */
    function setIterationMetadata(
        uint256 chainId,
        address jurySC,
        string calldata cid
    ) external onlyOwner {
        require(jurySC != address(0), "Invalid contract address");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");

        // After initialization: check if JurySC is locked for history
        if (initializationComplete) {
            IJurySC jury = IJurySC(jurySC);
            require(!jury.locked(), "Iteration locked (cannot modify historical data)");
        }
        // During initialization: no lock check (allows importing historical data)

        iterationMetadata[chainId][jurySC] = cid;
        emit IterationMetadataSet(chainId, jurySC, cid, msg.sender);
    }

    /**
     * @notice Set project metadata CID (owner during init, or authorized project after init)
     * @dev During initialization: Owner can set any project's metadata
     * @dev After initialization: Only authorized projects can set their own metadata, owner can only set iteration metadata
     * @dev Projects can only update metadata BEFORE voting starts (before projectsLocked)
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddress Project address
     * @param cid IPFS CID for project metadata
     */
    function setProjectMetadata(
        uint256 chainId,
        address jurySC,
        address projectAddress,
        string calldata cid
    ) external {
        require(jurySC != address(0), "Invalid contract address");
        require(projectAddress != address(0), "Invalid project address");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");

        bool isOwner = msg.sender == owner();

        // Access control logic:
        // BEFORE initialization complete: Owner can set any project metadata (for migration)
        // AFTER initialization complete: Only projects can set their own metadata
        if (!initializationComplete) {
            // Initialization phase: only owner can set project metadata
            require(isOwner, "Only owner can set metadata during initialization");
        } else {
            // Post-initialization: only the project itself can set its own metadata
            require(msg.sender == projectAddress, "Can only set own metadata");

            // Validate project is registered in JurySC and time window is valid
            IJurySC jury = IJurySC(jurySC);
            require(jury.isRegisteredProject(projectAddress), "Project not registered in JurySC");
            require(!jury.projectsLocked(), "Metadata editing closed (voting started)");
        }

        projectMetadata[chainId][jurySC][projectAddress] = cid;
        emit ProjectMetadataSet(chainId, jurySC, projectAddress, cid, msg.sender);
    }

    // ========== View Functions - Iterations/Rounds ==========

    /**
     * @notice Get iteration info by ID
     * @param iterationId Iteration ID
     * @return Iteration info struct
     */
    function getIteration(uint256 iterationId) external view returns (IterationInfo memory) {
        require(iterations[iterationId].exists, "Iteration not found");
        return iterations[iterationId];
    }

    /**
     * @notice Get all iterations
     * @return Array of all iteration IDs
     */
    function getAllIterationIds() external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](iterationCount);
        uint256 index = 0;

        // Iterate through possible iteration IDs (inefficient for large counts, but acceptable)
        for (uint256 i = 1; index < iterationCount && i <= iterationCount + 100; i++) {
            if (iterations[i].exists) {
                ids[index] = i;
                index++;
            }
        }

        return ids;
    }

    /**
     * @notice Get all rounds for an iteration
     * @param iterationId Iteration ID
     * @return Array of RoundInfo structs
     */
    function getRounds(uint256 iterationId) external view returns (RoundInfo[] memory) {
        require(iterations[iterationId].exists, "Iteration not found");

        uint256 count = iterations[iterationId].roundCount;
        RoundInfo[] memory result = new RoundInfo[](count);
        uint256 index = 0;

        // Iterate through possible round IDs
        for (uint256 i = 1; index < count && i <= MAX_ROUNDS_PER_ITERATION; i++) {
            if (rounds[iterationId][i].exists) {
                result[index] = rounds[iterationId][i];
                index++;
            }
        }

        return result;
    }

    /**
     * @notice Get round info by iteration and round ID
     * @param iterationId Iteration ID
     * @param roundId Round ID
     * @return Round info struct
     */
    function getRound(uint256 iterationId, uint256 roundId) external view returns (RoundInfo memory) {
        require(rounds[iterationId][roundId].exists, "Round not found");
        return rounds[iterationId][roundId];
    }

    /**
     * @notice Get round info by contract address (reverse lookup)
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @return Round info struct
     */
    function getRoundByContract(uint256 chainId, address jurySC) external view returns (RoundInfo memory) {
        RoundRef memory ref = roundByContract[chainId][jurySC];
        require(ref.exists, "Round not found for contract");
        return rounds[ref.iterationId][ref.roundId];
    }

    /**
     * @notice Get previous rounds for a given round (all rounds in same iteration with lower roundId)
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @return Array of previous round contracts
     */
    function getPrevRoundContracts(uint256 chainId, address jurySC) external view returns (address[] memory) {
        RoundRef memory ref = roundByContract[chainId][jurySC];
        require(ref.exists, "Round not found for contract");

        uint256 currentRoundId = ref.roundId;
        uint256 iterationId = ref.iterationId;

        // Count previous rounds (rounds with lower roundId in same iteration)
        uint256 count = 0;
        for (uint256 i = 1; i < currentRoundId; i++) {
            if (rounds[iterationId][i].exists) {
                count++;
            }
        }

        // Build array of previous round contracts
        address[] memory prevRounds = new address[](count);
        uint256 index = 0;
        for (uint256 i = 1; i < currentRoundId; i++) {
            if (rounds[iterationId][i].exists) {
                prevRounds[index] = rounds[iterationId][i].jurySC;
                index++;
            }
        }

        return prevRounds;
    }

    // ========== View Functions - Metadata ==========

    /**
     * @notice Get iteration metadata CID
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @return CID string (empty if not set)
     */
    function getIterationMetadata(
        uint256 chainId,
        address jurySC
    ) external view returns (string memory) {
        return iterationMetadata[chainId][jurySC];
    }

    /**
     * @notice Get project metadata CID
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddress Project address
     * @return CID string (empty if not set)
     */
    function getProjectMetadata(
        uint256 chainId,
        address jurySC,
        address projectAddress
    ) external view returns (string memory) {
        return projectMetadata[chainId][jurySC][projectAddress];
    }

    /**
     * @notice Batch get project metadata for multiple projects
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddresses Array of project addresses
     * @return Array of CID strings (empty string if not set)
     */
    function batchGetProjectMetadata(
        uint256 chainId,
        address jurySC,
        address[] calldata projectAddresses
    ) external view returns (string[] memory) {
        require(projectAddresses.length <= MAX_BATCH_SIZE, "Batch size too large");

        string[] memory cids = new string[](projectAddresses.length);

        uint256 length = projectAddresses.length;
        for (uint256 i = 0; i < length; i++) {
            cids[i] = projectMetadata[chainId][jurySC][projectAddresses[i]];
        }

        return cids;
    }

    // ========== Profile Functions ==========

    /**
     * @notice Set your own profile picture CID
     * @param cid IPFS CID of the profile picture
     */
    function setProfilePicture(string calldata cid) external {
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");
        profilePictureCID[msg.sender] = cid;
        emit ProfilePictureSet(msg.sender, cid);
    }

    /**
     * @notice Set your own profile bio CID
     * @param cid IPFS CID of the bio JSON
     */
    function setProfileBio(string calldata cid) external {
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");
        profileBioCID[msg.sender] = cid;
        emit ProfileBioSet(msg.sender, cid);
    }

    // ========== Adapter Routing Functions ==========

    /**
     * @notice Set adapter contract for a version (owner only)
     * @param versionId Version number (1, 2, ...)
     * @param adapter Adapter contract address implementing IVersionAdapter
     */
    function setAdapter(uint256 versionId, address adapter) external onlyOwner {
        require(versionId > 0, "Invalid version ID");
        require(adapter != address(0), "Invalid adapter address");
        versionAdapters[versionId] = adapter;
        emit AdapterSet(versionId, adapter);
    }

    /**
     * @notice Set the version for a specific round (owner only)
     * @param iterationId Iteration number
     * @param roundId Round number within iteration
     * @param versionId Version number (must have adapter set)
     */
    function setRoundVersion(uint256 iterationId, uint256 roundId, uint256 versionId) external onlyOwner {
        require(rounds[iterationId][roundId].exists, "Round not found");
        require(versionId > 0, "Invalid version ID");
        require(versionAdapters[versionId] != address(0), "Adapter not set for version");
        roundVersion[iterationId][roundId] = versionId;
        emit RoundVersionSet(iterationId, roundId, versionId);
    }

    /**
     * @notice Get the JurySC address and adapter for a specific round
     * @param iterationId Iteration number
     * @param roundId Round number within iteration
     * @return jurySC The JurySC contract address for this round
     * @return adapter The adapter contract address for this round's version
     */
    function getAdapterConfig(uint256 iterationId, uint256 roundId) external view returns (
        address jurySC,
        address adapter
    ) {
        require(rounds[iterationId][roundId].exists, "Round not found");
        uint256 versionId = roundVersion[iterationId][roundId];
        require(versionId > 0, "Version not set for round");
        adapter = versionAdapters[versionId];
        require(adapter != address(0), "Adapter not set for version");
        jurySC = rounds[iterationId][roundId].jurySC;
    }

    /**
     * @notice Get contract version string
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "3";
    }

    // ========== UUPS Upgrade Authorization ==========

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
