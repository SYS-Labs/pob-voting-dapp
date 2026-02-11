// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ICertMiddleware.sol";

/**
 * @title CertNFT
 * @notice Soulbound ERC721 certificates for PoB participants (non-community).
 *         One global contract across all iterations. Each cert links to an iteration
 *         via a per-iteration middleware that validates eligibility.
 */
contract CertNFT is
    ERC721Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ========== Constants ==========

    uint256 public constant PENDING_PERIOD = 48 hours;
    uint256 public constant MAX_CID_LENGTH = 100;

    // ========== Enums & Structs ==========

    enum CertStatus { Pending, Minted, Cancelled }

    struct CertData {
        uint256 iteration;
        address account;
        string certType;
        string infoCID;
        CertStatus status;
        uint256 requestTime;
    }

    // ========== State ==========

    /// @notice Token ID => certificate data
    mapping(uint256 => CertData) public certs;

    /// @notice Iteration => middleware contract address
    mapping(uint256 => address) public middleware;

    /// @notice Account => iteration => tokenId (0 means no cert)
    mapping(address => mapping(uint256 => uint256)) public certOf;

    /// @notice Next token ID to mint (starts at 1)
    uint256 public nextTokenId;

    // ========== Events ==========

    event CertRequested(uint256 indexed tokenId, uint256 indexed iteration, address indexed account, string certType);
    event CertCancelled(uint256 indexed tokenId);
    event MiddlewareSet(uint256 indexed iteration, address indexed addr);

    // ========== Errors ==========

    error AlreadyHasCert();
    error NoMiddleware();
    error NotEligible();
    error EmptyCID();
    error CIDTooLong();
    error InvalidToken();
    error NotPending();

    // ========== Initialization ==========

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC721_init("PoB Certificate", "POBCERT");
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        nextTokenId = 1;
    }

    // ========== Core Functions ==========

    /**
     * @notice Request a certificate for a given iteration
     * @param iteration The iteration number
     * @param infoCID IPFS CID of participant info JSON
     */
    function requestCert(uint256 iteration, string calldata infoCID) external nonReentrant {
        if (certOf[msg.sender][iteration] != 0) revert AlreadyHasCert();

        address mw = middleware[iteration];
        if (mw == address(0)) revert NoMiddleware();

        if (bytes(infoCID).length == 0) revert EmptyCID();
        if (bytes(infoCID).length > MAX_CID_LENGTH) revert CIDTooLong();

        (bool eligible, string memory certType) = ICertMiddleware(mw).validate(msg.sender);
        if (!eligible) revert NotEligible();

        uint256 tokenId = nextTokenId++;
        _mint(msg.sender, tokenId);

        certs[tokenId] = CertData({
            iteration: iteration,
            account: msg.sender,
            certType: certType,
            infoCID: infoCID,
            status: CertStatus.Pending,
            requestTime: block.timestamp
        });

        certOf[msg.sender][iteration] = tokenId;

        emit CertRequested(tokenId, iteration, msg.sender, certType);
    }

    /**
     * @notice Get the effective status of a certificate (auto-finalizes Pending after 48h)
     * @param tokenId The token ID
     * @return The effective CertStatus
     */
    function certStatus(uint256 tokenId) public view returns (CertStatus) {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();

        if (cert.status == CertStatus.Cancelled) return CertStatus.Cancelled;

        if (cert.status == CertStatus.Pending && block.timestamp >= cert.requestTime + PENDING_PERIOD) {
            return CertStatus.Minted;
        }

        return cert.status;
    }

    /**
     * @notice Returns on-chain JSON metadata for a certificate
     * @param tokenId The token ID
     * @return JSON string with certificate metadata
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        CertData storage cert = certs[tokenId];
        string memory statusStr = _statusString(certStatus(tokenId));
        string memory templatePart = _templatePart(cert.iteration);

        // Build JSON in two halves to avoid stack-too-deep
        string memory part1 = string(abi.encodePacked(
            '{"name":"PoB Certificate #', _toString(tokenId),
            '","description":"Proof-of-Builders Participation Certificate"',
            ',"attributes":[',
            '{"trait_type":"Iteration","value":', _toString(cert.iteration), '},'
        ));

        string memory part2 = string(abi.encodePacked(
            '{"trait_type":"Type","value":"', cert.certType, '"},',
            '{"trait_type":"Status","value":"', statusStr, '"}',
            ']',
            templatePart,
            ',"infoCID":"', cert.infoCID, '"}'
        ));

        return string(abi.encodePacked(part1, part2));
    }

    function _statusString(CertStatus s) internal pure returns (string memory) {
        if (s == CertStatus.Pending) return "Pending";
        if (s == CertStatus.Minted) return "Minted";
        return "Cancelled";
    }

    function _templatePart(uint256 iteration) internal view returns (string memory) {
        address mw = middleware[iteration];
        if (mw == address(0)) return "";
        try ICertMiddleware(mw).templateCID() returns (string memory t) {
            if (bytes(t).length > 0) {
                return string(abi.encodePacked(',"template":"', t, '"'));
            }
        } catch {}
        return "";
    }

    // ========== Admin Functions ==========

    /**
     * @notice Set the middleware contract for an iteration
     * @param iteration The iteration number
     * @param addr The middleware contract address
     */
    function setMiddleware(uint256 iteration, address addr) external onlyOwner {
        middleware[iteration] = addr;
        emit MiddlewareSet(iteration, addr);
    }

    /**
     * @notice Cancel a certificate (owner only, for moderation)
     * @param tokenId The token ID to cancel
     */
    function cancelCert(uint256 tokenId) external onlyOwner {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        if (cert.status == CertStatus.Cancelled) revert NotPending();

        cert.status = CertStatus.Cancelled;
        emit CertCancelled(tokenId);
    }

    // ========== Soulbound: Block Transfers ==========

    /**
     * @dev Override _update to prevent transfers. Only minting (from == address(0)) is allowed.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)), block all transfers
        if (from != address(0)) {
            revert("CertNFT: soulbound, transfers blocked");
        }
        return super._update(to, tokenId, auth);
    }

    // ========== UUPS ==========

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ========== Internal Helpers ==========

    /**
     * @dev Convert uint256 to string (minimal gas implementation)
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
