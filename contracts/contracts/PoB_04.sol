// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./IPoBRenderer.sol";

interface IJurySC_04 {
    function registeredNFT() external view returns (address);
    function isSmtVoter(address account) external view returns (bool);
    function isDaoHicVoter(address account) external view returns (bool);
    function isRegisteredProject(address account) external view returns (bool);
    function votingEnded() external view returns (bool);
    function isActive() external view returns (bool);
    function hasVotingEnded() external view returns (bool);
    function projectsLocked() external view returns (bool);
}

/**
 * @title PoB_04 - Proof of Builders NFT Badge (v4)
 * @notice Latest per-round badge contract used for fresh rounds and imported history.
 * @dev Keeps the existing badge model and adds explicit bulk import support for migration.
 */
contract PoB_04 is Initializable, ERC721Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using Strings for uint256;

    uint256 public constant MAX_IMPORT_BATCH_SIZE = 100;

    bool public mintingClosed;
    bool public importedHistorySealed;
    uint256 public nextId;
    uint256 public iteration;
    IPoBRenderer public renderer;
    address public rendererManager;
    address payable public communityDonationRecipient;

    mapping(uint256 => string) public roleOf;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => bool) public claimed;
    mapping(uint256 => bool) public importedTokenId;

    event Claimed(uint256 indexed tokenId, address indexed participant);
    event CommunityDonationForwarded(address indexed donor, address indexed recipient, uint256 amount);
    event CommunityDonationRecipientUpdated(address indexed recipient);
    event RendererUpdated(address indexed rendererAddress);
    event RendererManagerUpdated(address indexed rendererManagerAddress);
    event MintingClosed();
    event ImportedHistorySealed();

    error MintingIsClosed();
    error AlreadyClaimed();
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
    error ImportedBadgeClaimDisabled();
    error InvalidImportBatch();
    error InvalidImportRole();
    error BadgeImportConflict();
    error DuplicateBadgeOwner();
    error RendererNotSet();
    error InvalidRenderer();
    error NotRendererManager();
    error InvalidDonationRecipient();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 iteration_,
        address initialOwner,
        address initialRenderer,
        address payable initialCommunityDonationRecipient
    ) public initializer {
        __ERC721_init(name_, symbol_);
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        iteration = iteration_;
        if (initialCommunityDonationRecipient == address(0)) revert InvalidDonationRecipient();
        communityDonationRecipient = initialCommunityDonationRecipient;
        rendererManager = initialOwner;
        _setRenderer(initialRenderer);

        emit RendererManagerUpdated(initialOwner);
        emit CommunityDonationRecipientUpdated(initialCommunityDonationRecipient);
    }

    function setRenderer(address newRenderer) external {
        _checkRendererManager();
        _setRenderer(newRenderer);
    }

    function setRendererManager(address newRendererManager) external {
        _checkRendererManager();
        if (newRendererManager == address(0)) revert NotAuthorized();
        rendererManager = newRendererManager;
        emit RendererManagerUpdated(newRendererManager);
    }

    function setCommunityDonationRecipient(address payable newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidDonationRecipient();
        communityDonationRecipient = newRecipient;
        emit CommunityDonationRecipientUpdated(newRecipient);
    }

    /**
     * @notice Community minting with an optional donation.
     * @dev Community voters can mint for free or attach any desired amount,
     *      which is immediately forwarded to the configured donation recipient.
     *      Live v4 community badges are marked as already settled because
     *      there is no refundable deposit to claim later.
     */
    function mint() external payable returns (uint256) {
        if (mintingClosed || importedHistorySealed) revert MintingIsClosed();

        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_04 jury = IJurySC_04(juryAddress);
        if (jury.registeredNFT() != address(this)) revert InvalidJurySC();
        if (!jury.isActive()) revert NotActive();
        if (jury.isSmtVoter(msg.sender)) revert CannotMintAsSmt();
        if (jury.isDaoHicVoter(msg.sender)) revert CannotMintAsDaoHic();

        if (hasMinted[msg.sender]) {
            _refund(msg.sender, msg.value);
            return 0;
        }

        hasMinted[msg.sender] = true;
        uint256 tokenId = nextId++;
        _safeMint(msg.sender, tokenId);
        roleOf[tokenId] = "Community";
        claimed[tokenId] = true;

        _forwardDonation(msg.sender, msg.value);

        return tokenId;
    }

    function mintSmt() external returns (uint256) {
        if (mintingClosed || importedHistorySealed) revert MintingIsClosed();

        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_04 jury = IJurySC_04(juryAddress);
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

    function mintDaoHic() external returns (uint256) {
        if (mintingClosed || importedHistorySealed) revert MintingIsClosed();

        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_04 jury = IJurySC_04(juryAddress);
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

    function mintProject() external returns (uint256) {
        if (mintingClosed || importedHistorySealed) revert MintingIsClosed();

        address juryAddress = owner();
        if (juryAddress == address(0) || juryAddress.code.length == 0) revert InvalidJurySC();
        IJurySC_04 jury = IJurySC_04(juryAddress);
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

    function claim(uint256 tokenId) external nonReentrant {
        if (importedTokenId[tokenId]) revert ImportedBadgeClaimDisabled();
        if (keccak256(bytes(roleOf[tokenId])) != keccak256(bytes("Community"))) {
            revert OnlyCommunityCanClaim();
        }
        if (ownerOf(tokenId) != msg.sender) revert NotNFTOwner();
        if (claimed[tokenId]) revert AlreadyClaimed();

        IJurySC_04 jury = IJurySC_04(owner());
        if (!jury.votingEnded()) revert VotingNotEnded();

        claimed[tokenId] = true;

        emit Claimed(tokenId, msg.sender);
    }

    function closeMinting() external onlyOwner {
        mintingClosed = true;
        emit MintingClosed();
    }

    function importBadgeBatchFromJury(
        uint256[] calldata tokenIds,
        address[] calldata owners,
        string[] calldata roles,
        bool[] calldata claimedFlags
    ) external onlyOwner {
        if (importedHistorySealed) revert MintingIsClosed();

        uint256 length = tokenIds.length;
        if (
            length == 0 ||
            length > MAX_IMPORT_BATCH_SIZE ||
            owners.length != length ||
            roles.length != length ||
            claimedFlags.length != length
        ) {
            revert InvalidImportBatch();
        }

        uint256 updatedNextId = nextId;

        for (uint256 i = 0; i < length; i++) {
            uint256 tokenId = tokenIds[i];
            address badgeOwner = owners[i];
            if (badgeOwner == address(0)) revert NotAuthorized();
            _validateImportedRole(roles[i]);

            address existingOwner = _ownerOf(tokenId);
            if (existingOwner != address(0)) {
                if (
                    existingOwner != badgeOwner ||
                    !_sameString(roleOf[tokenId], roles[i]) ||
                    claimed[tokenId] != claimedFlags[i] ||
                    !importedTokenId[tokenId]
                ) {
                    revert BadgeImportConflict();
                }
                continue;
            }

            if (hasMinted[badgeOwner]) revert DuplicateBadgeOwner();

            hasMinted[badgeOwner] = true;
            _mint(badgeOwner, tokenId);
            roleOf[tokenId] = roles[i];
            claimed[tokenId] = claimedFlags[i];
            importedTokenId[tokenId] = true;

            if (tokenId >= updatedNextId) {
                updatedNextId = tokenId + 1;
            }
        }

        nextId = updatedNextId;
    }

    function sealImportedHistory() external onlyOwner {
        if (importedHistorySealed) revert MintingIsClosed();
        importedHistorySealed = true;
        mintingClosed = true;
        emit MintingClosed();
        emit ImportedHistorySealed();
    }

    function hasMintedBadge(address account) external view returns (bool) {
        return hasMinted[account];
    }

    function getRoleOf(uint256 tokenId) public view returns (string memory) {
        return roleOf[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (address(renderer) == address(0)) revert RendererNotSet();

        string memory role = roleOf[tokenId];
        string memory svg = renderer.renderSVG(
            PoBTemplateData({tokenId: tokenId, iteration: iteration, role: role})
        );

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(_buildMetadata(tokenId, role, svg)))
            )
        );
    }

    function _buildMetadata(uint256 tokenId, string memory role, string memory svg) internal view returns (string memory) {
        string memory name = string(abi.encodePacked("Proof of Builders #", iteration.toString(), " - ", role));
        string memory description = string(abi.encodePacked("Participant in PoB Iteration #", iteration.toString()));
        string memory image = string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(bytes(svg))));

        return string(
            abi.encodePacked(
                "{",
                '"name":"', name, '",',
                '"description":"', description, '",',
                '"image":"', image, '",',
                '"attributes":[', _buildAttributes(role), "]",
                "}"
            )
        );
    }

    function _buildAttributes(string memory role) internal view returns (string memory) {
        return string(
            abi.encodePacked(
                '{"trait_type":"Iteration","value":"', iteration.toString(), '"},',
                '{"trait_type":"Role","value":"', role, '"}'
            )
        );
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            address juryAddress = owner();
            if (juryAddress != address(0) && juryAddress.code.length > 0) {
                IJurySC_04 jury = IJurySC_04(juryAddress);
                if (jury.registeredNFT() == address(this) && jury.isActive()) {
                    revert TransferDuringVotingNotAllowed();
                }
            }
        }

        return super._update(to, tokenId, auth);
    }

    function _validateImportedRole(string calldata role) internal pure {
        bytes32 roleHash = keccak256(bytes(role));
        if (
            roleHash != keccak256(bytes("Community")) &&
            roleHash != keccak256(bytes("DAO-HIC")) &&
            roleHash != keccak256(bytes("SMT")) &&
            roleHash != keccak256(bytes("DevRel")) &&
            roleHash != keccak256(bytes("Project"))
        ) {
            revert InvalidImportRole();
        }
    }

    function _sameString(string memory a, string calldata b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _setRenderer(address rendererAddress) internal {
        if (rendererAddress == address(0)) revert InvalidRenderer();
        renderer = IPoBRenderer(rendererAddress);
        emit RendererUpdated(rendererAddress);
    }

    function _checkRendererManager() internal view {
        if (msg.sender != rendererManager && msg.sender != owner()) {
            revert NotRendererManager();
        }
    }

    function _forwardDonation(address donor, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        (bool success, ) = communityDonationRecipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit CommunityDonationForwarded(donor, communityDonationRecipient, amount);
    }

    function _refund(address recipient, uint256 amount) internal {
        if (amount == 0) {
            return;
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        (newImplementation);
    }

    receive() external payable {}
}
