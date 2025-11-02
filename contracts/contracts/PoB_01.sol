// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title PoB_01 - Proof of Builders NFT Badge
 * @notice Commemorative NFT badges for Proof of Builders iteration participants
 * @dev Non-upgradeable ERC721 with role-based minting and iteration tracking
 */

interface IJurySC_01 {
    function registeredNFT() external view returns (address);
    function isDevRelAccount(address account) external view returns (bool);
    function isDaoHicVoter(address account) external view returns (bool);
    function isRegisteredProject(address account) external view returns (bool);
    function votingEnded() external view returns (bool);
    function isActive() external view returns (bool);
    function hasVotingEnded() external view returns (bool);
    function projectsLocked() external view returns (bool);
}

contract PoB_01 is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant COMMUNITY_DEPOSIT = 30 ether; // 30 SYS

    bool public mintingClosed;
    uint256 public nextId;
    uint256 public immutable iteration; // Iteration number

    mapping(uint256 => string) public roleOf; // tokenId => role ("Community", "DevRel", "DAO-HIC", "Project")
    mapping(address => bool) public hasMinted; // One NFT per account across all roles
    mapping(uint256 => bool) public claimed; // Claim tracking (Community only)

    event Claimed(uint256 indexed tokenId, address indexed participant);
    event MintingClosed();

    error MintingIsClosed();
    error AlreadyClaimed();
    error InvalidAmount();
    error OnlyCommunityCanClaim();
    error VotingNotEnded();
    error TransferFailed();
    error InvalidJurySC();
    error NotAuthorized();
    error NotNFTOwner();
    error NotActive();
    error ProjectsNotLocked();

    /**
     * @notice Constructor
     * @param name_ NFT collection name
     * @param symbol_ NFT collection symbol
     * @param iteration_ Iteration number (immutable)
     * @param initialOwner Initial owner (should be JurySC_01 address)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 iteration_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        iteration = iteration_;
    }

    /**
     * @notice Community minting - Lock 30 SYS and receive NFT badge
     * @dev Silent duplicate prevention (no revert if already minted)
     * @dev Can only mint during active voting (need NFT to vote)
     * @return tokenId The minted token ID (0 if already minted)
     */
    function mint() external payable returns (uint256) {
        if (mintingClosed) revert MintingIsClosed();
        if (msg.value != COMMUNITY_DEPOSIT) revert InvalidAmount();

        // Verify JurySC_01 is valid and voting is active
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_01 jury = IJurySC_01(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isActive()) revert NotActive();

        // Silent duplicate prevention
        if (hasMinted[msg.sender]) {
            // Return deposit without minting
            (bool success, ) = msg.sender.call{value: msg.value}("");
            if (!success) revert TransferFailed();
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "Community";

        return tokenId;
    }

    /**
     * @notice DevRel special mint - Free badge for DevRel account
     * @dev Can only mint after voting ends (role is final)
     * @dev Can mint even after minting is closed or contract is locked (earned right)
     * @return tokenId The minted token ID (0 if already minted)
     */
    function mintDevRel() external returns (uint256) {
        // Verify JurySC_01 is valid
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_01 jury = IJurySC_01(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isDevRelAccount(msg.sender)) revert NotAuthorized();
        if (!jury.hasVotingEnded()) revert VotingNotEnded();

        // Silent duplicate prevention
        if (hasMinted[msg.sender]) {
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "DevRel";

        return tokenId;
    }

    /**
     * @notice DAO_HIC special mint - Free badge for DAO_HIC voter
     * @dev Can only mint after voting ends (voters list is final)
     * @dev Can mint even after minting is closed or contract is locked (earned right)
     * @return tokenId The minted token ID (0 if already minted)
     */
    function mintDaoHic() external returns (uint256) {
        // Verify JurySC_01 is valid
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_01 jury = IJurySC_01(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isDaoHicVoter(msg.sender)) revert NotAuthorized();
        if (!jury.hasVotingEnded()) revert VotingNotEnded();

        // Silent duplicate prevention
        if (hasMinted[msg.sender]) {
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "DAO-HIC";

        return tokenId;
    }

    /**
     * @notice Project special mint - Free badge for registered project
     * @dev Can only mint after voting starts (projects list is locked)
     * @dev Can mint even after minting is closed or contract is locked (earned right)
     * @return tokenId The minted token ID (0 if already minted)
     */
    function mintProject() external returns (uint256) {
        // Verify JurySC_01 is valid
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_01 jury = IJurySC_01(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isRegisteredProject(msg.sender)) revert NotAuthorized();
        if (!jury.projectsLocked()) revert ProjectsNotLocked();

        // Silent duplicate prevention
        if (hasMinted[msg.sender]) {
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "Project";

        return tokenId;
    }

    /**
     * @notice Claim 30 SYS deposit back (Community role only)
     * @param tokenId The NFT token ID to claim for
     */
    function claim(uint256 tokenId) external nonReentrant {
        // Verify role
        if (keccak256(bytes(roleOf[tokenId])) != keccak256(bytes("Community"))) {
            revert OnlyCommunityCanClaim();
        }

        // Verify ownership
        if (ownerOf(tokenId) != msg.sender) revert NotNFTOwner();

        // Verify not already claimed
        if (claimed[tokenId]) revert AlreadyClaimed();

        // Verify voting ended (query JurySC_01 via owner)
        IJurySC_01 jury = IJurySC_01(owner());
        if (!jury.votingEnded()) revert VotingNotEnded();

        // Mark as claimed
        claimed[tokenId] = true;

        // Transfer 30 SYS back
        (bool success, ) = msg.sender.call{value: COMMUNITY_DEPOSIT}("");
        if (!success) revert TransferFailed();

        emit Claimed(tokenId, msg.sender);
    }

    /**
     * @notice Close minting permanently (admin only)
     */
    function closeMinting() external onlyOwner {
        mintingClosed = true;
        emit MintingClosed();
    }

    /**
     * @notice Get role of a token
     * @param tokenId The token ID
     * @return role The role string ("Community", "DevRel", "DAO-HIC", or "Project")
     */
    function getRoleOf(uint256 tokenId) public view returns (string memory) {
        return roleOf[tokenId];
    }

    /**
     * @notice Generate token URI with metadata
     * @param tokenId The token ID
     * @return JSON metadata string
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory role = roleOf[tokenId];
        string memory name = string(abi.encodePacked("Proof of Builders #", iteration.toString(), " - ", role));
        string memory description = string(abi.encodePacked("Participant in PoB Iteration #", iteration.toString()));

        // Simple JSON metadata (could be replaced with base64 encoding or external URI)
        return string(
            abi.encodePacked(
                '{"name":"', name, '",',
                '"description":"', description, '",',
                '"iteration":', iteration.toString(), ',',
                '"role":"', role, '"}'
            )
        );
    }

    /**
     * @notice Allow contract to receive SYS
     */
    receive() external payable {}
}
