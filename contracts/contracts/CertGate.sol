// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ICertGate.sol";

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
 * @title IJurySC_V3ForCert
 * @notice Minimal interface for JurySC_03 which uses isSmtVoter instead of isDevRelAccount
 */
interface IJurySC_V3ForCert {
    function isSmtVoter(address) external view returns (bool);
}

/**
 * @title CertGate
 * @notice Per-iteration certificate eligibility gate (formerly CertMiddleware).
 *         Non-upgradeable. One instance deployed per iteration.
 *         Validates that an account participated as a non-community role
 *         across ALL rounds of an iteration before granting certificate eligibility.
 *
 *         Template storage (hash + CID) has been moved to PoBRegistry so the API
 *         is the single gatekeeper for sanitizing and publishing SVG templates.
 */
contract CertGate is Ownable, ICertGate {

    // ========== Constants ==========

    uint256 public constant MAX_ROLE_LENGTH = 64;

    // ========== State ==========

    /// @notice PoB badge contracts for each round (ordered by round)
    address[] public pobContracts;

    /// @notice JurySC voting contracts for each round (ordered by round)
    address[] public jurySCContracts;

    /// @notice Owner-registered roles (for organizers, speakers, etc.)
    mapping(address => string) public registeredRole;

    // ========== Events ==========

    event RoleRegistered(address indexed account, string role);
    event RoleRemoved(address indexed account);

    // ========== Errors ==========

    error ArrayLengthMismatch();
    error EmptyArrays();
    error VotingNotEnded();
    error NotParticipant();
    error InvalidAddress();

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

        for (uint256 i = 0; i < pobContracts_.length; i++) {
            if (pobContracts_[i] == address(0) || jurySCContracts_[i] == address(0)) revert InvalidAddress();
            if (pobContracts_[i].code.length == 0 || jurySCContracts_[i].code.length == 0) revert InvalidAddress();
        }

        pobContracts = pobContracts_;
        jurySCContracts = jurySCContracts_;
    }

    // ========== ICertGate Implementation ==========

    /**
     * @notice Validate whether an account is eligible for a certificate
     * @dev Validation logic:
     *   1. If registeredRole[account] is set => (true, registeredRole)
     *   2. All rounds must have voting ended
     *   3. Account must have minted badge AND have non-community role in EACH round
     *   4. Winner check: iterate rounds in reverse, first hasWinner=true is authoritative
     * @dev Registered roles (step 1) intentionally bypass all subsequent checks by design.
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

            // Must have a non-community role (DevRel/SMT, DAO-HIC, or Project)
            IJurySCForCert jury = IJurySCForCert(jurySCContracts[i]);
            bool hasNonCommunityRole;
            try jury.isDevRelAccount(account) returns (bool result) {
                hasNonCommunityRole = result;
            } catch {
                // v3 contract — try isSmtVoter
                try IJurySC_V3ForCert(jurySCContracts[i]).isSmtVoter(account) returns (bool result) {
                    hasNonCommunityRole = result;
                } catch {
                    hasNonCommunityRole = false;
                }
            }
            if (!hasNonCommunityRole) {
                try jury.isDaoHicVoter(account) returns (bool result) {
                    hasNonCommunityRole = result;
                } catch {
                    hasNonCommunityRole = false;
                }
            }
            if (!hasNonCommunityRole) {
                try jury.isRegisteredProject(account) returns (bool result) {
                    hasNonCommunityRole = result;
                } catch {
                    hasNonCommunityRole = false;
                }
            }
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

    // ========== View Helpers ==========

    /**
     * @notice Get the number of rounds in this iteration
     * @return The round count
     */
    function roundCount() external view returns (uint256) {
        return pobContracts.length;
    }

    // ========== Owner Functions ==========

    /**
     * @notice Register a special role for an address (organizer, speaker, etc.)
     * @param account The address to register
     * @param role The role string
     */
    function registerRole(address account, string calldata role) external onlyOwner {
        require(bytes(role).length > 0, "Empty role");
        require(bytes(role).length <= MAX_ROLE_LENGTH, "Role too long");
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
