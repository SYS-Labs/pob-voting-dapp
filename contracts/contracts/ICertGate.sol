// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICertGate
 * @notice Interface for per-iteration certificate validation gate (formerly ICertMiddleware).
 *         Template storage has moved to PoBRegistry; this interface covers eligibility only.
 */
interface ICertGate {
    /**
     * @notice Check if an account is eligible for a certificate in this iteration
     * @param account The address to validate
     * @return eligible Whether the account is eligible
     * @return certType The type of certificate ("participant", "winner", "organizer", "speaker", etc.)
     */
    function validate(address account) external view returns (bool eligible, string memory certType);

    /**
     * @notice Check if an account is a registered project in any round
     * @param account The address to check
     * @return Whether the account is a project in any round
     */
    function isProjectInAnyRound(address account) external view returns (bool);
}
