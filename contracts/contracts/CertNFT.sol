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
    uint256 public constant MAX_TEAM_MEMBERS = 20;
    uint256 public constant MAX_NAME_LENGTH = 64;

    // ========== Enums & Structs ==========

    enum CertStatus { Pending, Minted, Cancelled }
    enum MemberStatus { Proposed, Approved, Rejected }

    struct CertData {
        uint256 iteration;
        address account;
        string certType;
        string infoCID;
        CertStatus status;
        uint256 requestTime;
    }

    struct TeamMember {
        address memberAddress;
        MemberStatus status;
        string fullName;
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

    /// @notice Iteration => project => team members array
    mapping(uint256 => mapping(address => TeamMember[])) internal _teamMembers;

    /// @notice Iteration => project => member address => index+1 (0 means not found)
    mapping(uint256 => mapping(address => mapping(address => uint256))) public teamMemberIndex;

    /// @notice Iteration => project => count of approved members
    mapping(uint256 => mapping(address => uint256)) public approvedMemberCount;

    /// @notice Iteration => project => count of approved members with name set
    mapping(uint256 => mapping(address => uint256)) public namedMemberCount;

    // ========== Events ==========

    event CertRequested(uint256 indexed tokenId, uint256 indexed iteration, address indexed account, string certType);
    event CertCancelled(uint256 indexed tokenId);
    event MiddlewareSet(uint256 indexed iteration, address indexed addr);

    event TeamMemberProposed(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberApproved(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberRejected(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberNameSet(uint256 indexed iteration, address indexed project, address indexed member, string fullName);

    // ========== Errors ==========

    error AlreadyHasCert();
    error NoMiddleware();
    error NotEligible();
    error EmptyCID();
    error CIDTooLong();
    error InvalidToken();
    error NotPending();

    error NotProjectForIteration();
    error MemberAlreadyExists();
    error TooManyMembers();
    error InvalidMemberIndex();
    error MemberNotApproved();
    error NameAlreadySet();
    error EmptyName();
    error NameTooLong();
    error NoNamedTeamMembers();
    error NotTeamMember();
    error CertAlreadyRequested();

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

        // Only enforce team member requirement for project addresses
        if (ICertMiddleware(mw).isProjectInAnyRound(msg.sender)) {
            if (namedMemberCount[iteration][msg.sender] == 0) revert NoNamedTeamMembers();
        }

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
        string memory teamPart = _teamMembersPart(cert.iteration, cert.account);

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
            teamPart,
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

    /**
     * @dev Build a JSON array of approved team member names for tokenURI
     */
    function _teamMembersPart(uint256 iteration, address project) internal view returns (string memory) {
        TeamMember[] storage members = _teamMembers[iteration][project];
        if (members.length == 0) return "";

        // Count approved members with names
        uint256 count = 0;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].status == MemberStatus.Approved && bytes(members[i].fullName).length > 0) {
                count++;
            }
        }
        if (count == 0) return "";

        bytes memory result = ',"teamMembers":[';
        bool first = true;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].status == MemberStatus.Approved && bytes(members[i].fullName).length > 0) {
                if (!first) {
                    result = abi.encodePacked(result, ',');
                }
                result = abi.encodePacked(result, '"', members[i].fullName, '"');
                first = false;
            }
        }
        result = abi.encodePacked(result, ']');

        return string(result);
    }

    // ========== Team Member Functions ==========

    /**
     * @notice Propose a new team member for a project iteration
     * @param iteration The iteration number
     * @param member The address of the team member to propose
     */
    function proposeTeamMember(uint256 iteration, address member) external {
        address mw = middleware[iteration];
        if (mw == address(0)) revert NoMiddleware();
        if (!ICertMiddleware(mw).isProjectInAnyRound(msg.sender)) revert NotProjectForIteration();
        if (certOf[msg.sender][iteration] != 0) revert CertAlreadyRequested();
        if (teamMemberIndex[iteration][msg.sender][member] != 0) revert MemberAlreadyExists();
        if (_teamMembers[iteration][msg.sender].length >= MAX_TEAM_MEMBERS) revert TooManyMembers();

        _teamMembers[iteration][msg.sender].push(TeamMember({
            memberAddress: member,
            status: MemberStatus.Proposed,
            fullName: ""
        }));
        teamMemberIndex[iteration][msg.sender][member] = _teamMembers[iteration][msg.sender].length; // index+1

        emit TeamMemberProposed(iteration, msg.sender, member);
    }

    /**
     * @notice Approve a proposed team member (owner only)
     * @param iteration The iteration number
     * @param project The project address
     * @param member The team member address to approve
     */
    function approveTeamMember(uint256 iteration, address project, address member) external onlyOwner {
        if (certOf[project][iteration] != 0) revert CertAlreadyRequested();

        uint256 idx = teamMemberIndex[iteration][project][member];
        if (idx == 0) revert InvalidMemberIndex();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];
        if (tm.status != MemberStatus.Proposed) revert InvalidMemberIndex();

        tm.status = MemberStatus.Approved;
        approvedMemberCount[iteration][project]++;

        emit TeamMemberApproved(iteration, project, member);
    }

    /**
     * @notice Reject a proposed team member (owner only)
     * @param iteration The iteration number
     * @param project The project address
     * @param member The team member address to reject
     */
    function rejectTeamMember(uint256 iteration, address project, address member) external onlyOwner {
        if (certOf[project][iteration] != 0) revert CertAlreadyRequested();

        uint256 idx = teamMemberIndex[iteration][project][member];
        if (idx == 0) revert InvalidMemberIndex();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];
        if (tm.status != MemberStatus.Proposed) revert InvalidMemberIndex();

        tm.status = MemberStatus.Rejected;

        emit TeamMemberRejected(iteration, project, member);
    }

    /**
     * @notice Set own full name as an approved team member
     * @param iteration The iteration number
     * @param project The project address
     * @param fullName The full name to set (immutable once set)
     */
    function setTeamMemberName(uint256 iteration, address project, string calldata fullName) external {
        if (certOf[project][iteration] != 0) revert CertAlreadyRequested();

        uint256 idx = teamMemberIndex[iteration][project][msg.sender];
        if (idx == 0) revert NotTeamMember();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];
        if (tm.status != MemberStatus.Approved) revert MemberNotApproved();
        if (bytes(tm.fullName).length > 0) revert NameAlreadySet();
        if (bytes(fullName).length == 0) revert EmptyName();
        if (bytes(fullName).length > MAX_NAME_LENGTH) revert NameTooLong();

        tm.fullName = fullName;
        namedMemberCount[iteration][project]++;

        emit TeamMemberNameSet(iteration, project, msg.sender, fullName);
    }

    // ========== Team Member View Functions ==========

    /**
     * @notice Get all team members for a project iteration
     * @param iteration The iteration number
     * @param project The project address
     * @return Array of TeamMember structs
     */
    function getTeamMembers(uint256 iteration, address project) external view returns (TeamMember[] memory) {
        return _teamMembers[iteration][project];
    }

    /**
     * @notice Get the number of team members for a project iteration
     * @param iteration The iteration number
     * @param project The project address
     * @return The number of team members
     */
    function getTeamMemberCount(uint256 iteration, address project) external view returns (uint256) {
        return _teamMembers[iteration][project].length;
    }

    /**
     * @notice Get a single team member by index
     * @param iteration The iteration number
     * @param project The project address
     * @param index The array index
     * @return memberAddress The member's address
     * @return status The member's status
     * @return fullName The member's name
     */
    function getTeamMember(uint256 iteration, address project, uint256 index) external view
        returns (address memberAddress, MemberStatus status, string memory fullName)
    {
        if (index >= _teamMembers[iteration][project].length) revert InvalidMemberIndex();
        TeamMember storage tm = _teamMembers[iteration][project][index];
        return (tm.memberAddress, tm.status, tm.fullName);
    }

    /**
     * @notice Check if a project has at least one approved member with a name set
     * @param iteration The iteration number
     * @param project The project address
     * @return Whether the project has named team members
     */
    function hasNamedTeamMembers(uint256 iteration, address project) external view returns (bool) {
        return namedMemberCount[iteration][project] > 0;
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

    // ========== Version ==========

    function version() external pure returns (string memory) {
        return "1";
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
