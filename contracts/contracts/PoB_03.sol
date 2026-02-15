// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title PoB_03 - Proof of Builders NFT Badge (v3)
 * @notice Commemorative NFT badges for Proof of Builders iteration participants
 * @dev Non-upgradeable ERC721 with role-based minting. Replaces DevRel with SMT.
 */

interface IJurySC_03 {
    function registeredNFT() external view returns (address);
    function isSmtVoter(address account) external view returns (bool);
    function isDaoHicVoter(address account) external view returns (bool);
    function isRegisteredProject(address account) external view returns (bool);
    function votingEnded() external view returns (bool);
    function isActive() external view returns (bool);
    function hasVotingEnded() external view returns (bool);
    function projectsLocked() external view returns (bool);
}

contract PoB_03 is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant COMMUNITY_DEPOSIT = 30 ether; // 30 SYS

    bool public mintingClosed;
    uint256 public nextId;
    uint256 public immutable iteration;

    mapping(uint256 => string) public roleOf;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => bool) public claimed;

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
    error CannotMintAsSmt();
    error CannotMintAsDaoHic();
    error TransferDuringVotingNotAllowed();

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
     * @dev Can only mint during active voting (need NFT to vote)
     */
    function mint() external payable returns (uint256) {
        if (mintingClosed) revert MintingIsClosed();
        if (msg.value != COMMUNITY_DEPOSIT) revert InvalidAmount();

        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_03 jury = IJurySC_03(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isActive()) revert NotActive();
        if (jury.isSmtVoter(msg.sender)) revert CannotMintAsSmt();
        if (jury.isDaoHicVoter(msg.sender)) revert CannotMintAsDaoHic();

        if (hasMinted[msg.sender]) {
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
     * @notice SMT special mint - Free badge for SMT voter
     * @dev Can only mint after voting ends (role is final)
     */
    function mintSmt() external returns (uint256) {
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_03 jury = IJurySC_03(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isSmtVoter(msg.sender)) revert NotAuthorized();
        if (!jury.hasVotingEnded()) revert VotingNotEnded();

        if (hasMinted[msg.sender]) {
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "SMT";

        return tokenId;
    }

    /**
     * @notice DAO_HIC special mint - Free badge for DAO_HIC voter
     * @dev Can only mint after voting ends
     */
    function mintDaoHic() external returns (uint256) {
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_03 jury = IJurySC_03(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isDaoHicVoter(msg.sender)) revert NotAuthorized();
        if (!jury.hasVotingEnded()) revert VotingNotEnded();

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
     * @dev Can only mint after projects are locked (after activation)
     */
    function mintProject() external returns (uint256) {
        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_03 jury = IJurySC_03(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isRegisteredProject(msg.sender)) revert NotAuthorized();
        if (!jury.projectsLocked()) revert ProjectsNotLocked();

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
        if (keccak256(bytes(roleOf[tokenId])) != keccak256(bytes("Community"))) {
            revert OnlyCommunityCanClaim();
        }
        if (ownerOf(tokenId) != msg.sender) revert NotNFTOwner();
        if (claimed[tokenId]) revert AlreadyClaimed();

        IJurySC_03 jury = IJurySC_03(owner());
        if (!jury.votingEnded()) revert VotingNotEnded();

        claimed[tokenId] = true;

        (bool success, ) = msg.sender.call{value: COMMUNITY_DEPOSIT}("");
        if (!success) revert TransferFailed();

        emit Claimed(tokenId, msg.sender);
    }

    function closeMinting() external onlyOwner {
        mintingClosed = true;
        emit MintingClosed();
    }

    function hasMintedBadge(address account) external view returns (bool) {
        return hasMinted[account];
    }

    function getRoleOf(uint256 tokenId) public view returns (string memory) {
        return roleOf[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory role = roleOf[tokenId];
        string memory name = string(abi.encodePacked("Proof of Builders #", iteration.toString(), " - ", role));
        string memory description = string(abi.encodePacked("Participant in PoB Iteration #", iteration.toString()));

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
     * @notice Override _update to block transfers during active voting
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            address juryAddress = owner();
            if (juryAddress != address(0) && juryAddress.code.length > 0) {
                IJurySC_03 jury = IJurySC_03(juryAddress);
                if (jury.registeredNFT() == address(this) && jury.isActive()) {
                    revert TransferDuringVotingNotAllowed();
                }
            }
        }

        return super._update(to, tokenId, auth);
    }

    receive() external payable {}
}
