// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

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

    /// @notice Maximum number of previous round contracts that can be stored
    uint256 public constant MAX_PREV_ROUNDS = 100;

    /// @notice Maximum batch size for batch operations
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice Maximum length for CID strings
    uint256 public constant MAX_CID_LENGTH = 100;

    // ========== State Variables ==========

    /// @notice Metadata CID for an iteration
    /// @dev Mapping: chainId => jurySCAddress => CID
    mapping(uint256 => mapping(address => string)) public iterationMetadata;

    /// @notice Metadata CID for a project within an iteration
    /// @dev Mapping: chainId => jurySCAddress => projectAddress => CID
    mapping(uint256 => mapping(address => mapping(address => string))) public projectMetadata;

    /// @notice Previous round contracts for an iteration
    /// @dev Mapping: chainId => jurySCAddress => array of previous round addresses
    mapping(uint256 => mapping(address => address[])) public prevRoundContracts;

    /// @notice Authorized project addresses per iteration (only these can set their own metadata)
    /// @dev Mapping: chainId => jurySCAddress => projectAddress => isAuthorized
    mapping(uint256 => mapping(address => mapping(address => bool))) public authorizedProjects;

    // ========== Events ==========

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

    event PrevRoundsSet(
        uint256 indexed chainId,
        address indexed jurySC,
        address[] prevRounds
    );

    event ProjectAuthorized(
        uint256 indexed chainId,
        address indexed jurySC,
        address indexed projectAddress,
        bool authorized
    );

    // ========== Initialization ==========

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    // ========== Admin Functions ==========

    /**
     * @notice Set iteration metadata CID (owner only)
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

        iterationMetadata[chainId][jurySC] = cid;
        emit IterationMetadataSet(chainId, jurySC, cid, msg.sender);
    }

    /**
     * @notice Set previous round contracts for an iteration (owner only)
     * @param chainId Chain ID
     * @param jurySC JurySC contract address for current iteration
     * @param prevRounds Array of previous round JurySC addresses
     */
    function setPrevRoundContracts(
        uint256 chainId,
        address jurySC,
        address[] calldata prevRounds
    ) external onlyOwner {
        require(jurySC != address(0), "Invalid contract address");
        require(prevRounds.length <= MAX_PREV_ROUNDS, "Too many previous rounds");

        prevRoundContracts[chainId][jurySC] = prevRounds;
        emit PrevRoundsSet(chainId, jurySC, prevRounds);
    }

    /**
     * @notice Authorize or deauthorize a project to set its own metadata
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddress Project address to authorize/deauthorize
     * @param authorized True to authorize, false to revoke
     */
    function setProjectAuthorization(
        uint256 chainId,
        address jurySC,
        address projectAddress,
        bool authorized
    ) external onlyOwner {
        require(jurySC != address(0), "Invalid contract address");
        require(projectAddress != address(0), "Invalid project address");

        authorizedProjects[chainId][jurySC][projectAddress] = authorized;
        emit ProjectAuthorized(chainId, jurySC, projectAddress, authorized);
    }

    /**
     * @notice Batch authorize multiple projects (owner only)
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddresses Array of project addresses to authorize
     */
    function batchAuthorizeProjects(
        uint256 chainId,
        address jurySC,
        address[] calldata projectAddresses
    ) external onlyOwner {
        require(jurySC != address(0), "Invalid contract address");
        require(projectAddresses.length <= MAX_BATCH_SIZE, "Batch size too large");

        uint256 length = projectAddresses.length;
        for (uint256 i = 0; i < length; i++) {
            address projectAddress = projectAddresses[i];
            require(projectAddress != address(0), "Invalid project address");

            authorizedProjects[chainId][jurySC][projectAddress] = true;
            emit ProjectAuthorized(chainId, jurySC, projectAddress, true);
        }
    }

    /**
     * @notice Set project metadata CID (owner or authorized project)
     * @dev Projects can only set their own metadata if authorized
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

        // Owner can set any project's metadata
        // Projects can only set their own metadata if authorized
        bool isOwner = msg.sender == owner();
        bool isAuthorizedProject =
            msg.sender == projectAddress &&
            authorizedProjects[chainId][jurySC][projectAddress];

        require(
            isOwner || isAuthorizedProject,
            "Not authorized to set metadata"
        );

        projectMetadata[chainId][jurySC][projectAddress] = cid;
        emit ProjectMetadataSet(chainId, jurySC, projectAddress, cid, msg.sender);
    }

    // ========== View Functions ==========

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
     * @notice Get previous round contracts for an iteration
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @return Array of previous round addresses
     */
    function getPrevRoundContracts(
        uint256 chainId,
        address jurySC
    ) external view returns (address[] memory) {
        return prevRoundContracts[chainId][jurySC];
    }

    /**
     * @notice Check if a project is authorized to set its own metadata
     * @param chainId Chain ID
     * @param jurySC JurySC contract address
     * @param projectAddress Project address
     * @return True if authorized
     */
    function isProjectAuthorized(
        uint256 chainId,
        address jurySC,
        address projectAddress
    ) external view returns (bool) {
        return authorizedProjects[chainId][jurySC][projectAddress];
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

    // ========== UUPS Upgrade Authorization ==========

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
