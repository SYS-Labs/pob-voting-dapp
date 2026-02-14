// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ICertMiddleware.sol";

/**
 * @title IPoB
 * @notice Minimal interface for PoB badge contracts (works for both PoB_01 and PoB_02)
 */
interface IPoB {
    function hasMinted(address) external view returns (bool);
}

/**
 * @title IJurySCForCert
 * @notice Minimal interface for JurySC contracts needed by cert validation
 */
interface IJurySCForCert {
    function hasVotingEnded() external view returns (bool);
    function getWinner() external view returns (address, bool);
    function isDevRelAccount(address) external view returns (bool);
    function isDaoHicVoter(address) external view returns (bool);
    function isRegisteredProject(address) external view returns (bool);
}

/**
 * @title CertMiddleware_001
 * @notice Per-iteration certificate validation middleware.
 *         Non-upgradeable. One instance deployed per iteration.
 *         Validates that an account participated as a non-community role
 *         across ALL rounds of an iteration before granting certificate eligibility.
 */
contract CertMiddleware_001 is Ownable, ICertMiddleware {

    // ========== State ==========

    /// @notice PoB badge contracts for each round (ordered by round)
    address[] public pobContracts;

    /// @notice JurySC voting contracts for each round (ordered by round)
    address[] public jurySCContracts;

    /// @notice IPFS CID of the certificate template
    string private _templateCID;

    /// @notice Owner-registered roles (for organizers, speakers, etc.)
    mapping(address => string) public registeredRole;

    // ========== Events ==========

    event TemplateCIDSet(string cid);
    event RoleRegistered(address indexed account, string role);
    event RoleRemoved(address indexed account);

    // ========== Errors ==========

    error ArrayLengthMismatch();
    error EmptyArrays();
    error VotingNotEnded();
    error NotParticipant();

    // ========== Constructor ==========

    /**
     * @param pobContracts_ Array of PoB addresses for each round in this iteration
     * @param jurySCContracts_ Array of JurySC addresses for each round in this iteration
     * @param owner_ Owner address for admin functions
     */
    constructor(
        address[] memory pobContracts_,
        address[] memory jurySCContracts_,
        address owner_
    ) Ownable(owner_) {
        if (pobContracts_.length == 0) revert EmptyArrays();
        if (pobContracts_.length != jurySCContracts_.length) revert ArrayLengthMismatch();

        pobContracts = pobContracts_;
        jurySCContracts = jurySCContracts_;
    }

    // ========== ICertMiddleware Implementation ==========

    /**
     * @notice Validate whether an account is eligible for a certificate
     * @dev Validation logic:
     *   1. If registeredRole[account] is set => (true, registeredRole)
     *   2. All rounds must have voting ended
     *   3. Account must have minted badge AND have non-community role in EACH round
     *   4. Winner check: iterate rounds in reverse, first hasWinner=true is authoritative
     * @param account The address to check
     * @return eligible Whether the account qualifies
     * @return certType The certificate type string
     */
    function validate(address account) external view override returns (bool eligible, string memory certType) {
        // 1. Check registered roles first (organizer, speaker, etc.)
        bytes memory role = bytes(registeredRole[account]);
        if (role.length > 0) {
            return (true, registeredRole[account]);
        }

        uint256 numRounds = pobContracts.length;

        // 2. All rounds must have voting ended
        for (uint256 i = 0; i < numRounds; i++) {
            if (!IJurySCForCert(jurySCContracts[i]).hasVotingEnded()) {
                return (false, "");
            }
        }

        // 3. Badge + non-community role check for each round
        for (uint256 i = 0; i < numRounds; i++) {
            // Must have minted a badge in this round
            if (!IPoB(pobContracts[i]).hasMinted(account)) {
                return (false, "");
            }

            // Must have a non-community role (DevRel, DAO-HIC, or Project)
            IJurySCForCert jury = IJurySCForCert(jurySCContracts[i]);
            bool hasNonCommunityRole = jury.isDevRelAccount(account) ||
                                       jury.isDaoHicVoter(account) ||
                                       jury.isRegisteredProject(account);
            if (!hasNonCommunityRole) {
                return (false, "");
            }
        }

        // 4. Winner check: iterate in reverse, first round with hasWinner=true is authoritative
        for (uint256 i = numRounds; i > 0; i--) {
            (address winnerAddr, bool hasWinner) = IJurySCForCert(jurySCContracts[i - 1]).getWinner();
            if (hasWinner) {
                if (account == winnerAddr) {
                    return (true, "winner");
                }
                break; // First found winner round is authoritative
            }
        }

        return (true, "participant");
    }

    /**
     * @notice Get the template CID for this iteration's certificates
     * @return The IPFS CID string
     */
    function templateCID() external view override returns (string memory) {
        return _templateCID;
    }

    // ========== View Helpers ==========

    /**
     * @notice Get the number of rounds in this iteration
     * @return The round count
     */
    function roundCount() external view returns (uint256) {
        return pobContracts.length;
    }

    /**
     * @notice Check if an account is a registered project in any round
     * @param account The address to check
     * @return Whether the account is a project in any round
     */
    function isProjectInAnyRound(address account) external view override returns (bool) {
        for (uint256 i = 0; i < jurySCContracts.length; i++) {
            if (IJurySCForCert(jurySCContracts[i]).isRegisteredProject(account)) return true;
        }
        return false;
    }

    // ========== Owner Functions ==========

    /**
     * @notice Set the template CID for certificate artwork
     * @param cid IPFS CID of the template
     */
    function setTemplateCID(string calldata cid) external onlyOwner {
        _templateCID = cid;
        emit TemplateCIDSet(cid);
    }

    /**
     * @notice Register a special role for an address (organizer, speaker, etc.)
     * @param account The address to register
     * @param role The role string
     */
    function registerRole(address account, string calldata role) external onlyOwner {
        require(bytes(role).length > 0, "Empty role");
        registeredRole[account] = role;
        emit RoleRegistered(account, role);
    }

    /**
     * @notice Remove a registered role
     * @param account The address to remove
     */
    function removeRole(address account) external onlyOwner {
        delete registeredRole[account];
        emit RoleRemoved(account);
    }
}
