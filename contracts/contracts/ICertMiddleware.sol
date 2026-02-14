// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICertMiddleware
 * @notice Interface for per-iteration certificate validation middleware
 */
interface ICertMiddleware {
    /**
     * @notice Check if an account is eligible for a certificate in this iteration
     * @param account The address to validate
     * @return eligible Whether the account is eligible
     * @return certType The type of certificate ("participant", "winner", "organizer", "speaker", etc.)
     */
    function validate(address account) external view returns (bool eligible, string memory certType);

    /**
     * @notice Get the IPFS CID of the certificate template for this iteration
     * @return The template CID string
     */
    function templateCID() external view returns (string memory);

    /**
     * @notice Check if an account is a registered project in any round
     * @param account The address to check
     * @return Whether the account is a project in any round
     */
    function isProjectInAnyRound(address account) external view returns (bool);
}
