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

    /// @notice Version ID => adapter contract address
    mapping(uint256 => address) public versionAdapters;

    /// @notice Iteration ID => round ID => version number
    mapping(uint256 => mapping(uint256 => uint256)) public roundVersion;

    /// @notice Voting mode override for jurySC contracts with incorrect on-chain values
    /// @dev Stores mode + 1 (0 = no override, 1 = CONSENSUS override, 2 = WEIGHTED override)
    mapping(address => uint8) public votingModeOverride;

    // ========== Template Storage (v3) ==========

    /// @notice Certificate template for an iteration (hash + version + CID)
    /// @dev Set exclusively by the API's /publish endpoint after SVG sanitization.
    ///      On-chain hash is always computed from sanitized bytes only.
    struct IterationTemplate {
        bytes32 hash;       // keccak256 of the sanitized SVG bytes
        uint32 version;     // auto-incremented on each update
        string cid;         // IPFS CID of the pinned sanitized SVG
    }

    /// @notice iterationId => certificate template
    mapping(uint256 => IterationTemplate) public iterationTemplates;

    /// @notice Imported-history tracking by iteration
    mapping(uint256 => bool) public importedIterations;

    /// @notice Imported-history tracking by iteration/round
    mapping(uint256 => mapping(uint256 => bool)) public importedRounds;

    /// @notice Seal flag for imported rounds; once sealed, metadata writes are blocked
    mapping(uint256 => mapping(uint256 => bool)) public importedRoundSealed;

    /// @notice Monotonic batch id used by imported-history events
    uint256 public importBatchCount;

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
    event VotingModeOverrideSet(address indexed jurySC, uint8 mode);
    event TemplateSet(uint256 indexed iterationId, bytes32 indexed templateHash, string cid);
    event ImportedIteration(uint256 indexed iterationId, uint256 indexed chainId, uint256 indexed batchId, string proofCid);
    event ImportedRound(
        uint256 indexed iterationId,
        uint256 indexed roundId,
        address indexed jurySC,
        uint256 batchId,
        uint256 versionId,
        string proofCid
    );
    event ImportedIterationMetadata(
        uint256 indexed iterationId,
        uint256 indexed roundId,
        address indexed jurySC,
        uint256 batchId,
        string cid,
        string proofCid
    );
    event ImportedProjectMetadata(
        uint256 indexed iterationId,
        uint256 indexed roundId,
        address indexed projectAddress,
        uint256 batchId,
        string cid,
        string proofCid
    );
    event ImportedHistorySealed(uint256 indexed iterationId, uint256 indexed roundId, uint256 indexed batchId, string proofCid);

    // ========== Errors ==========

    error ZeroAddress();
    error NotAContract();
    error ImportedRoundSealed(uint256 iterationId, uint256 roundId);

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

    function _nextImportBatchId() internal returns (uint256) {
        importBatchCount++;
        return importBatchCount;
    }

    function _validateProofCid(string calldata proofCid) internal pure {
        require(bytes(proofCid).length > 0, "Proof CID cannot be empty");
        require(bytes(proofCid).length <= MAX_CID_LENGTH, "Proof CID too long");
    }

    function _requireRoundNotSealed(uint256 chainId, address jurySC) internal view {
        RoundRef memory ref = roundByContract[chainId][jurySC];
        if (ref.exists && importedRoundSealed[ref.iterationId][ref.roundId]) {
            revert ImportedRoundSealed(ref.iterationId, ref.roundId);
        }
    }

    function _registerIterationInternal(uint256 iterationId, uint256 chainId) internal {
        require(iterationId > 0, "Invalid iteration ID");
        require(chainId > 0, "Invalid chain ID");
        require(!iterations[iterationId].exists, "Iteration already registered");
        require(iterationId == iterationCount + 1, "Iteration ID must be contiguous");

        iterations[iterationId] = IterationInfo({
            iterationId: iterationId,
            chainId: chainId,
            roundCount: 0,
            exists: true
        });

        iterationCount++;
    }

    function _addRoundInternal(
        uint256 iterationId,
        uint256 roundId,
        address jurySC,
        uint256 deployBlockHint
    ) internal returns (address pob) {
        require(iterations[iterationId].exists, "Iteration not registered");
        require(roundId > 0, "Invalid round ID");
        require(roundId <= MAX_ROUNDS_PER_ITERATION, "Round ID exceeds max");
        require(jurySC != address(0), "Invalid jurySC address");
        require(!rounds[iterationId][roundId].exists, "Round already exists");

        uint256 chainId = iterations[iterationId].chainId;
        require(!roundByContract[chainId][jurySC].exists, "JurySC already registered");
        require(iterations[iterationId].roundCount < MAX_ROUNDS_PER_ITERATION, "Max rounds reached");

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

        pob = address(0);
        try IJurySC(jurySC).pob() returns (address pobAddress) {
            pob = pobAddress;
        } catch {
            // No-op, used for event emission only.
        }
    }

    function _setRoundVersionInternal(uint256 iterationId, uint256 roundId, uint256 versionId) internal {
        require(rounds[iterationId][roundId].exists, "Round not found");
        require(versionId > 0, "Invalid version ID");
        require(versionAdapters[versionId] != address(0), "Adapter not set for version");
        roundVersion[iterationId][roundId] = versionId;
    }

    function _setIterationMetadataInternal(
        uint256 chainId,
        address jurySC,
        string calldata cid
    ) internal {
        require(jurySC != address(0), "Invalid contract address");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");
        _requireRoundNotSealed(chainId, jurySC);
        iterationMetadata[chainId][jurySC] = cid;
    }

    function _setProjectMetadataInternal(
        uint256 chainId,
        address jurySC,
        address projectAddress,
        string calldata cid
    ) internal {
        require(jurySC != address(0), "Invalid contract address");
        require(projectAddress != address(0), "Invalid project address");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");
        _requireRoundNotSealed(chainId, jurySC);
        projectMetadata[chainId][jurySC][projectAddress] = cid;
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
        _registerIterationInternal(iterationId, chainId);
        emit IterationRegistered(iterationId, chainId);
    }

    function registerImportedIteration(
        uint256 iterationId,
        uint256 chainId,
        string calldata proofCid
    ) external onlyOwner {
        _validateProofCid(proofCid);
        _registerIterationInternal(iterationId, chainId);
        importedIterations[iterationId] = true;

        uint256 batchId = _nextImportBatchId();
        emit IterationRegistered(iterationId, chainId);
        emit ImportedIteration(iterationId, chainId, batchId, proofCid);
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
        uint256 chainId = iterations[iterationId].chainId;
        address pob = _addRoundInternal(iterationId, roundId, jurySC, deployBlockHint);

        emit RoundAdded(iterationId, roundId, jurySC, pob, chainId);
    }

    function registerImportedRound(
        uint256 iterationId,
        uint256 roundId,
        address jurySC,
        uint256 deployBlockHint,
        uint256 versionId,
        string calldata proofCid
    ) external onlyOwner {
        _validateProofCid(proofCid);
        uint256 chainId = iterations[iterationId].chainId;
        address pob = _addRoundInternal(iterationId, roundId, jurySC, deployBlockHint);
        _setRoundVersionInternal(iterationId, roundId, versionId);
        importedRounds[iterationId][roundId] = true;

        uint256 batchId = _nextImportBatchId();
        emit RoundAdded(iterationId, roundId, jurySC, pob, chainId);
        emit RoundVersionSet(iterationId, roundId, versionId);
        emit ImportedRound(iterationId, roundId, jurySC, batchId, versionId, proofCid);
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
        _setIterationMetadataInternal(chainId, jurySC, cid);

        // After initialization: check if JurySC is locked for history
        if (initializationComplete) {
            IJurySC jury = IJurySC(jurySC);
            require(!jury.locked(), "Iteration locked (cannot modify historical data)");
        }

        emit IterationMetadataSet(chainId, jurySC, cid, msg.sender);
    }

    function importIterationMetadata(
        uint256 chainId,
        address jurySC,
        string calldata cid,
        string calldata proofCid
    ) external onlyOwner {
        _validateProofCid(proofCid);
        RoundRef memory ref = roundByContract[chainId][jurySC];
        require(ref.exists, "Round not found");
        _setIterationMetadataInternal(chainId, jurySC, cid);

        uint256 batchId = _nextImportBatchId();
        emit IterationMetadataSet(chainId, jurySC, cid, msg.sender);
        emit ImportedIterationMetadata(ref.iterationId, ref.roundId, jurySC, batchId, cid, proofCid);
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

        _setProjectMetadataInternal(chainId, jurySC, projectAddress, cid);
        emit ProjectMetadataSet(chainId, jurySC, projectAddress, cid, msg.sender);
    }

    function importProjectMetadataBatch(
        uint256 chainId,
        address jurySC,
        address[] calldata projectAddresses,
        string[] calldata cids,
        string calldata proofCid
    ) external onlyOwner {
        _validateProofCid(proofCid);
        uint256 length = projectAddresses.length;
        require(length > 0, "Empty batch");
        require(length <= MAX_BATCH_SIZE, "Batch too large");
        require(cids.length == length, "Array length mismatch");

        RoundRef memory ref = roundByContract[chainId][jurySC];
        require(ref.exists, "Round not found");

        uint256 batchId = _nextImportBatchId();
        for (uint256 i = 0; i < length; i++) {
            IJurySC jury = IJurySC(jurySC);
            require(jury.isRegisteredProject(projectAddresses[i]), "Project not registered in JurySC");
            _setProjectMetadataInternal(chainId, jurySC, projectAddresses[i], cids[i]);
            emit ProjectMetadataSet(chainId, jurySC, projectAddresses[i], cids[i], msg.sender);
            emit ImportedProjectMetadata(ref.iterationId, ref.roundId, projectAddresses[i], batchId, cids[i], proofCid);
        }
    }

    function sealImportedRound(
        uint256 iterationId,
        uint256 roundId,
        string calldata proofCid
    ) external onlyOwner {
        _validateProofCid(proofCid);
        require(rounds[iterationId][roundId].exists, "Round not found");
        require(importedRounds[iterationId][roundId], "Round not imported");
        require(!importedRoundSealed[iterationId][roundId], "Imported round already sealed");
        importedRoundSealed[iterationId][roundId] = true;

        uint256 batchId = _nextImportBatchId();
        emit ImportedHistorySealed(iterationId, roundId, batchId, proofCid);
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
        if (adapter == address(0)) revert ZeroAddress();
        if (adapter.code.length == 0) revert NotAContract();
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
        _setRoundVersionInternal(iterationId, roundId, versionId);
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

    // ========== Voting Mode Override Functions ==========

    /**
     * @notice Set voting mode override for a jurySC contract (owner only)
     * @dev Stores mode + 1 internally (0 = no override, 1 = CONSENSUS, 2 = WEIGHTED)
     * @param jurySC JurySC contract address
     * @param mode Voting mode (0 = CONSENSUS, 1 = WEIGHTED)
     */
    function setVotingModeOverride(address jurySC, uint8 mode) external onlyOwner {
        require(jurySC != address(0), "Invalid address");
        require(mode <= 1, "Invalid voting mode");
        votingModeOverride[jurySC] = mode + 1;
        emit VotingModeOverrideSet(jurySC, mode);
    }

    // ========== Template Functions ==========

    /**
     * @notice Set the certificate template for an iteration (owner only)
     * @dev Must only be called with a hash produced by the API's /publish endpoint
     *      after SVG sanitization. Never accept caller-provided CID/hash directly.
     * @param iterationId Iteration number
     * @param templateHash keccak256 of the sanitized SVG bytes
     * @param cid IPFS CID of the pinned sanitized SVG
     */
    function setIterationTemplate(
        uint256 iterationId,
        bytes32 templateHash,
        string calldata cid
    ) external onlyOwner {
        require(iterationId > 0, "Invalid iteration ID");
        require(templateHash != bytes32(0), "Invalid template hash");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(cid).length <= MAX_CID_LENGTH, "CID too long");

        iterationTemplates[iterationId].version++;
        iterationTemplates[iterationId].hash = templateHash;
        iterationTemplates[iterationId].cid = cid;

        emit TemplateSet(iterationId, templateHash, cid);
    }

    /**
     * @notice Get the certificate template for an iteration
     * @param iterationId Iteration number
     * @return hash keccak256 of the sanitized SVG bytes (zero if not set)
     * @return templateVersion Auto-incremented version counter
     * @return cid IPFS CID of the sanitized SVG (empty if not set)
     */
    function getIterationTemplate(uint256 iterationId)
        external
        view
        returns (bytes32 hash, uint32 templateVersion, string memory cid)
    {
        IterationTemplate storage t = iterationTemplates[iterationId];
        return (t.hash, t.version, t.cid);
    }

    /**
     * @notice Get contract version string
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "4";
    }

    // ========== UUPS Upgrade Authorization ==========

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
