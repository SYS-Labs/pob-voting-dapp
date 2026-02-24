// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ICertGate.sol";

/**
 * @title IPoBRegistryForCert
 * @notice Minimal interface for PoBRegistry template queries used by CertNFT
 */
interface IPoBRegistryForCert {
    function getIterationTemplate(uint256 iterationId)
        external
        view
        returns (bytes32 hash, uint32 version, string memory cid);
}

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
    uint256 public constant MAX_TEAM_MEMBERS = 20;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_TEMPLATE_SIZE = 102400; // 100KB

    // ========== Enums & Structs ==========

    enum CertStatus { Pending, Minted, Cancelled, Requested }
    enum MemberStatus { Proposed, Approved, Rejected }

    struct CertData {
        uint256 iteration;
        address account;
        string certType;
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

    /// @notice PoBRegistry contract address (source of truth for template hash + CID)
    address public pobRegistry;

    /// @notice Next token ID to mint (starts at 1)
    uint256 public nextTokenId;

    /// @notice Iteration => project => team members array
    mapping(uint256 => mapping(address => TeamMember[])) internal _teamMembers;

    /// @notice Iteration => project => member address => index+1 (0 means not found)
    mapping(uint256 => mapping(address => mapping(address => uint256))) public teamMemberIndex;

    /// @notice Iteration => project => count of approved members
    mapping(uint256 => mapping(address => uint256)) public approvedMemberCount;

    /// @notice Iteration => project => count of members (Proposed or Approved) with name set
    mapping(uint256 => mapping(address => uint256)) public namedMemberCount;

    // ========== Events ==========

    event CertRequested(uint256 indexed tokenId, uint256 indexed iteration, address indexed account, string certType);
    event CertApproved(uint256 indexed tokenId);
    event CertCancelled(uint256 indexed tokenId);
    event CertFinalized(uint256 indexed tokenId);
    event MiddlewareSet(uint256 indexed iteration, address indexed addr);

    event TeamMemberProposed(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberApproved(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberRejected(uint256 indexed iteration, address indexed project, address indexed member);
    event TeamMemberNameSet(uint256 indexed iteration, address indexed project, address indexed member, string fullName);
    event CertResubmitted(uint256 indexed tokenId, uint256 indexed iteration, address indexed account);
    event TeamMemberRemoved(uint256 indexed iteration, address indexed project, address indexed member);
    event PoBRegistrySet(address indexed addr);

    // ========== Errors ==========

    error AlreadyHasCert();
    error NoMiddleware();
    error NotEligible();
    error InvalidToken();
    error NotPending();
    error NotRequested();
    error TemplateHashMismatch();
    error TemplateTooLarge();
    error NoActiveTemplate();

    error NotProjectForIteration();
    error MemberAlreadyExists();
    error TooManyMembers();
    error InvalidMemberIndex();
    error MemberNotApproved();
    error NameAlreadySet();
    error EmptyName();
    error NameTooLong();
    error NameContainsInvalidBytes();
    error NoNamedTeamMembers();
    error NoApprovedTeamMembers();
    error NotTeamMember();
    error CertAlreadyRequested();
    error NotCancelled();
    error AlreadyMinted();
    error WrongStage();
    error MissingPlaceholder();
    error ZeroAddress();
    error NotAContract();

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
     */
    function requestCert(uint256 iteration) external nonReentrant {
        if (certOf[msg.sender][iteration] != 0) revert AlreadyHasCert();

        address mw = middleware[iteration];
        if (mw == address(0)) revert NoMiddleware();

        (bool eligible, string memory certType) = ICertGate(mw).validate(msg.sender);
        if (!eligible) revert NotEligible();

        if (ICertGate(mw).isProjectInAnyRound(msg.sender)) {
            if (namedMemberCount[iteration][msg.sender] == 0) revert NoNamedTeamMembers();
        }

        uint256 tokenId = nextTokenId++;
        _mint(msg.sender, tokenId);

        certs[tokenId] = CertData({
            iteration: iteration,
            account: msg.sender,
            certType: certType,
            status: CertStatus.Requested,
            requestTime: 0
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
        if (cert.status == CertStatus.Requested) return CertStatus.Requested;

        if (cert.status == CertStatus.Pending && block.timestamp >= cert.requestTime + PENDING_PERIOD) {
            return CertStatus.Minted;
        }

        return cert.status;
    }

    /**
     * @notice Check if a certificate is valid (effective status is Minted)
     * @dev All integrations must use this instead of ownerOf/balanceOf.
     * @param tokenId The token ID
     * @return Whether the certificate is valid (Minted)
     */
    function isValidCert(uint256 tokenId) external view returns (bool) {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) return false;
        return certStatus(tokenId) == CertStatus.Minted;
    }

    /**
     * @notice Resubmit a cancelled certificate request, reusing the same tokenId
     * @param tokenId The token ID to resubmit
     */
    function resubmitCert(uint256 tokenId) external nonReentrant {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        if (cert.account != msg.sender) revert NotEligible();
        if (certStatus(tokenId) != CertStatus.Cancelled) revert NotCancelled();

        address mw = middleware[cert.iteration];
        if (mw != address(0) && ICertGate(mw).isProjectInAnyRound(msg.sender)) {
            if (namedMemberCount[cert.iteration][msg.sender] == 0) revert NoNamedTeamMembers();
        }

        cert.status = CertStatus.Requested;
        cert.requestTime = 0;
        emit CertResubmitted(tokenId, cert.iteration, msg.sender);
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
            '{"trait_type":"Type","value":"', _jsonEscape(cert.certType), '"},',
            '{"trait_type":"Status","value":"', statusStr, '"}',
            ']',
            templatePart,
            teamPart,
            '}'
        ));

        return string(abi.encodePacked(part1, part2));
    }

    function _statusString(CertStatus s) internal pure returns (string memory) {
        if (s == CertStatus.Pending) return "Pending";
        if (s == CertStatus.Minted) return "Minted";
        if (s == CertStatus.Requested) return "Requested";
        return "Cancelled";
    }

    function _templatePart(uint256 iteration) internal view returns (string memory) {
        if (pobRegistry == address(0)) return "";
        try IPoBRegistryForCert(pobRegistry).getIterationTemplate(iteration)
            returns (bytes32, uint32, string memory t)
        {
            if (bytes(t).length > 0) {
                return string(abi.encodePacked(',"template":"', _jsonEscape(t), '"'));
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
        if (member == address(0)) revert InvalidMemberIndex();
        address mw = middleware[iteration];
        if (mw == address(0)) revert NoMiddleware();
        if (!ICertGate(mw).isProjectInAnyRound(msg.sender)) revert NotProjectForIteration();
        if (_certStage(msg.sender, iteration) != 1) revert WrongStage();
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
        if (_certStage(project, iteration) != 2) revert WrongStage();

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
        if (_certStage(project, iteration) != 2) revert WrongStage();

        uint256 idx = teamMemberIndex[iteration][project][member];
        if (idx == 0) revert InvalidMemberIndex();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];
        if (tm.status != MemberStatus.Proposed) revert InvalidMemberIndex();

        if (bytes(tm.fullName).length > 0) namedMemberCount[iteration][project]--;
        tm.status = MemberStatus.Rejected;

        emit TeamMemberRejected(iteration, project, member);
    }

    /**
     * @notice Remove a team member (project only, Stage 1 only)
     * @dev Removes members of any status (Proposed, Approved, Rejected).
     *      Decrements approvedMemberCount and namedMemberCount as appropriate.
     * @param iteration The iteration number
     * @param member The address of the team member to remove
     */
    function removeTeamMember(uint256 iteration, address member) external {
        if (_certStage(msg.sender, iteration) != 1) revert WrongStage();

        address project = msg.sender;
        uint256 idx = teamMemberIndex[iteration][project][member];
        if (idx == 0) revert InvalidMemberIndex();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];

        // Update counters before removal
        if (tm.status == MemberStatus.Approved) approvedMemberCount[iteration][project]--;
        // Rejected members already had namedMemberCount decremented in rejectTeamMember(); skip to avoid underflow
        if (bytes(tm.fullName).length > 0 && tm.status != MemberStatus.Rejected) namedMemberCount[iteration][project]--;

        // Swap-and-pop
        uint256 lastIndex = _teamMembers[iteration][project].length - 1;
        if (idx - 1 != lastIndex) {
            TeamMember storage lastMember = _teamMembers[iteration][project][lastIndex];
            _teamMembers[iteration][project][idx - 1] = lastMember;
            teamMemberIndex[iteration][project][lastMember.memberAddress] = idx;
        }
        _teamMembers[iteration][project].pop();
        delete teamMemberIndex[iteration][project][member];

        emit TeamMemberRemoved(iteration, project, member);
    }

    /**
     * @notice Set own full name as a proposed or approved team member (Stage 1 only)
     * @dev Names can be set as soon as a member is proposed; no prior approval required.
     *      Re-editable across Cancelled cycles. Rejected members cannot set names.
     * @param iteration The iteration number
     * @param project The project address
     * @param fullName The full name to set (re-editable in Stage 1)
     */
    function setTeamMemberName(uint256 iteration, address project, string calldata fullName) external {
        if (_certStage(project, iteration) != 1) revert WrongStage();

        uint256 idx = teamMemberIndex[iteration][project][msg.sender];
        if (idx == 0) revert NotTeamMember();

        TeamMember storage tm = _teamMembers[iteration][project][idx - 1];
        if (tm.status == MemberStatus.Rejected) revert MemberNotApproved();
        if (bytes(fullName).length == 0) revert EmptyName();
        if (bytes(fullName).length > MAX_NAME_LENGTH) revert NameTooLong();

        bytes memory nameBytes = bytes(fullName);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 b = nameBytes[i];
            if (b == 0x22 || b == 0x5C || b < 0x20) revert NameContainsInvalidBytes();
        }

        bool wasNamed = bytes(tm.fullName).length > 0;
        tm.fullName = fullName;
        if (!wasNamed) namedMemberCount[iteration][project]++;

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
     * @notice Set the PoBRegistry address (source of truth for template hash + CID)
     * @param addr The PoBRegistry proxy address
     */
    function setPoBRegistry(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        if (addr.code.length == 0) revert NotAContract();
        pobRegistry = addr;
        emit PoBRegistrySet(addr);
    }

    /**
     * @notice Set the middleware contract for an iteration
     * @param iteration The iteration number
     * @param addr The middleware contract address
     */
    function setMiddleware(uint256 iteration, address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        if (addr.code.length == 0) revert NotAContract();
        middleware[iteration] = addr;
        emit MiddlewareSet(iteration, addr);
    }

    /**
     * @notice Approve a requested certificate, starting the 48h pending period
     * @param tokenId The token ID to approve
     */
    function approveCert(uint256 tokenId) external onlyOwner {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        if (cert.status != CertStatus.Requested) revert NotRequested();

        address mw = middleware[cert.iteration];
        if (mw != address(0) && ICertGate(mw).isProjectInAnyRound(cert.account)) {
            if (approvedMemberCount[cert.iteration][cert.account] == 0) revert NoApprovedTeamMembers();
        }

        cert.status = CertStatus.Pending;
        cert.requestTime = block.timestamp;
        emit CertApproved(tokenId);
    }

    /**
     * @notice Cancel a certificate (owner only, for moderation)
     * @param tokenId The token ID to cancel
     */
    function cancelCert(uint256 tokenId) external onlyOwner {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        CertStatus effective = certStatus(tokenId);
        if (effective == CertStatus.Minted) revert AlreadyMinted();
        if (effective == CertStatus.Cancelled) revert NotPending();

        cert.status = CertStatus.Cancelled;
        cert.requestTime = 0;
        emit CertCancelled(tokenId);
    }

    /**
     * @notice Finalize a pending certificate immediately (owner only, bypass 48h wait)
     * @param tokenId The token ID to finalize
     */
    function finalizeCert(uint256 tokenId) external onlyOwner {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        if (cert.status != CertStatus.Pending) revert NotPending();
        cert.status = CertStatus.Minted;
        emit CertFinalized(tokenId);
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

    // ========== SVG Rendering ==========

    /**
     * @notice Render an SVG certificate by injecting on-chain data into a template
     * @param tokenId The token ID to render
     * @param templateBytes The raw SVG template bytes (fetched from IPFS by caller)
     * @return The rendered SVG string with placeholders replaced
     */
    function renderSVG(uint256 tokenId, bytes calldata templateBytes) external view returns (string memory) {
        CertData storage cert = certs[tokenId];
        if (cert.account == address(0)) revert InvalidToken();
        if (templateBytes.length > MAX_TEMPLATE_SIZE) revert TemplateTooLarge();

        if (middleware[cert.iteration] == address(0)) revert NoMiddleware();

        bytes32 expectedHash;
        if (pobRegistry != address(0)) {
            try IPoBRegistryForCert(pobRegistry).getIterationTemplate(cert.iteration)
                returns (bytes32 h, uint32, string memory)
            {
                expectedHash = h;
            } catch {}
        }
        if (expectedHash == bytes32(0)) revert NoActiveTemplate();
        if (keccak256(templateBytes) != expectedHash) revert TemplateHashMismatch();

        bytes memory result = templateBytes;

        // Replace 6 fixed placeholders — revert if any is absent (template integrity)
        bool found;
        (result, found) = _replacePlaceholder(result, "{{CERT_TYPE}}", bytes(_xmlEscape(cert.certType)));
        if (!found) revert MissingPlaceholder();
        (result, found) = _replacePlaceholder(result, "{{ITERATION}}", bytes(_toString(cert.iteration)));
        if (!found) revert MissingPlaceholder();
        (result, found) = _replacePlaceholder(result, "{{TEAM_MEMBERS}}", bytes(_xmlEscape(_buildTeamString(cert.iteration, cert.account))));
        if (!found) revert MissingPlaceholder();
        (result, found) = _replacePlaceholder(result, "{{ACCOUNT}}", bytes(_addressToString(cert.account)));
        if (!found) revert MissingPlaceholder();
        (result, found) = _replacePlaceholder(result, "{{STATUS}}", bytes(_statusString(certStatus(tokenId))));
        if (!found) revert MissingPlaceholder();
        (result, found) = _replacePlaceholder(result, "{{TOKEN_ID}}", bytes(_toString(tokenId)));
        if (!found) revert MissingPlaceholder();

        return string(result);
    }

    // ========== Version ==========

    function version() external pure returns (string memory) {
        return "1";
    }

    // ========== UUPS ==========

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ========== Internal Helpers ==========

    /**
     * @dev Determine the lifecycle stage of a project's cert for an iteration.
     *      1 = No cert or Cancelled, 2 = Requested, 3 = Pending, 4 = Minted.
     */
    function _certStage(address project, uint256 iteration) private view returns (uint8) {
        uint256 tokenId = certOf[project][iteration];
        if (tokenId == 0) return 1;
        CertStatus s = certStatus(tokenId);
        if (s == CertStatus.Cancelled) return 1;
        if (s == CertStatus.Requested) return 2;
        if (s == CertStatus.Pending)   return 3;
        return 4; // Minted
    }

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

    /**
     * @dev XML-escape a string (escapes &, <, >, ", ')
     */
    function _xmlEscape(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        // First pass: count extra bytes needed
        uint256 extra = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") extra += 4;       // & → &amp; (5-1=4)
            else if (c == "<") extra += 3;  // < → &lt; (4-1=3)
            else if (c == ">") extra += 3;  // > → &gt;
            else if (c == '"') extra += 5;  // " → &quot; (6-1=5)
            else if (c == "'") extra += 5;  // ' → &apos;
        }
        if (extra == 0) return input;

        bytes memory result = new bytes(b.length + extra);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") {
                result[j++] = "&"; result[j++] = "a"; result[j++] = "m"; result[j++] = "p"; result[j++] = ";";
            } else if (c == "<") {
                result[j++] = "&"; result[j++] = "l"; result[j++] = "t"; result[j++] = ";";
            } else if (c == ">") {
                result[j++] = "&"; result[j++] = "g"; result[j++] = "t"; result[j++] = ";";
            } else if (c == '"') {
                result[j++] = "&"; result[j++] = "q"; result[j++] = "u"; result[j++] = "o"; result[j++] = "t"; result[j++] = ";";
            } else if (c == "'") {
                result[j++] = "&"; result[j++] = "a"; result[j++] = "p"; result[j++] = "o"; result[j++] = "s"; result[j++] = ";";
            } else {
                result[j++] = c;
            }
        }
        return string(result);
    }

    /**
     * @dev JSON-escape a string (escapes \ to \\ and " to \")
     */
    function _jsonEscape(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        uint256 extra = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x5C || c == 0x22) extra += 1; // \ or " each adds one extra byte
        }
        if (extra == 0) return input;

        bytes memory result = new bytes(b.length + extra);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x5C) {
                result[j++] = 0x5C; result[j++] = 0x5C; // \\
            } else if (c == 0x22) {
                result[j++] = 0x5C; result[j++] = 0x22; // \"
            } else {
                result[j++] = c;
            }
        }
        return string(result);
    }

    /**
     * @dev Replaces the FIRST occurrence of `placeholder` in `source` with `replacement`.
     *      Single-occurrence replacement is by design; each SVG template must use each
     *      placeholder exactly once — duplicate placeholders are a template integrity error.
     *      Returns (result, true) when the placeholder was found and replaced.
     *      Returns (source, false) when the placeholder is absent; callers must revert.
     */
    function _replacePlaceholder(bytes memory source, bytes memory placeholder, bytes memory replacement)
        internal pure returns (bytes memory, bool)
    {
        // Find placeholder position
        uint256 pos = type(uint256).max;
        if (source.length >= placeholder.length) {
            uint256 searchLen = source.length - placeholder.length + 1;
            for (uint256 i = 0; i < searchLen; i++) {
                bool found = true;
                for (uint256 k = 0; k < placeholder.length; k++) {
                    if (source[i + k] != placeholder[k]) {
                        found = false;
                        break;
                    }
                }
                if (found) {
                    pos = i;
                    break;
                }
            }
        }

        // Not found — signal to caller
        if (pos == type(uint256).max) return (source, false);

        // Build result: before + replacement + after
        bytes memory result = new bytes(source.length - placeholder.length + replacement.length);
        uint256 j = 0;
        for (uint256 i = 0; i < pos; i++) {
            result[j++] = source[i];
        }
        for (uint256 i = 0; i < replacement.length; i++) {
            result[j++] = replacement[i];
        }
        for (uint256 i = pos + placeholder.length; i < source.length; i++) {
            result[j++] = source[i];
        }
        return (result, true);
    }

    /**
     * @dev Convert an address to a lowercase hex string with 0x prefix
     */
    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory result = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        bytes memory alphabet = "0123456789abcdef";
        uint160 value = uint160(addr);
        for (uint256 i = 41; i >= 2; i--) {
            result[i] = alphabet[value & 0xf];
            value >>= 4;
        }
        return string(result);
    }

    /**
     * @dev Build a comma-separated string of approved named team members
     */
    function _buildTeamString(uint256 iteration, address project) internal view returns (string memory) {
        TeamMember[] storage members = _teamMembers[iteration][project];
        if (members.length == 0) return "";

        bytes memory result;
        bool first = true;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i].status == MemberStatus.Approved && bytes(members[i].fullName).length > 0) {
                if (!first) {
                    result = abi.encodePacked(result, ", ");
                }
                result = abi.encodePacked(result, members[i].fullName);
                first = false;
            }
        }
        return string(result);
    }
}
