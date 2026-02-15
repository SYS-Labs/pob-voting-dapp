// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVersionAdapter
 * @notice Unified read interface for all JurySC/PoB contract versions.
 *         All functions receive the jurySC address as a parameter.
 *         PoB is auto-discovered via jurySC.pob().
 *         Entity-generic: entityId 0 = DevRel/SMT, entityId 1 = DAO_HIC.
 */
interface IVersionAdapter {
    // ========== Lifecycle ==========

    function iteration(address jurySC) external view returns (uint256);
    function startTime(address jurySC) external view returns (uint64);
    function endTime(address jurySC) external view returns (uint64);
    function isActive(address jurySC) external view returns (bool);
    function hasVotingEnded(address jurySC) external view returns (bool);
    function votingEnded(address jurySC) external view returns (bool);

    // ========== State ==========

    function locked(address jurySC) external view returns (bool);
    function projectsLocked(address jurySC) external view returns (bool);
    function votingMode(address jurySC) external view returns (uint8);
    function owner(address jurySC) external view returns (address);

    // ========== Projects ==========

    function getProjectAddresses(address jurySC) external view returns (address[] memory);
    function isRegisteredProject(address jurySC, address project) external view returns (bool);

    // ========== Entity-Generic (0=DevRel/SMT, 1=DAO_HIC) ==========

    function getEntityVoters(address jurySC, uint8 entityId) external view returns (address[] memory);
    function entityVoteOf(address jurySC, uint8 entityId, address voter) external view returns (address);
    function entityHasVoted(address jurySC, uint8 entityId, address voter) external view returns (bool);
    function isEntityVoter(address jurySC, uint8 entityId, address voter) external view returns (bool);
    function getEntityVote(address jurySC, uint8 entityId) external view returns (address);

    // ========== Community (tokenId-based) ==========

    function communityVoteOf(address jurySC, uint256 tokenId) external view returns (address);
    function communityHasVoted(address jurySC, uint256 tokenId) external view returns (bool);
    function getCommunityEntityVote(address jurySC) external view returns (address);

    // ========== Aggregates ==========

    function getVoteParticipationCounts(address jurySC) external view returns (uint256, uint256, uint256);
    function getProjectVoteBreakdown(address jurySC, address project) external view returns (uint256, uint256);

    // ========== Results ==========

    function getWinner(address jurySC) external view returns (address, bool);
    function getWinnerConsensus(address jurySC) external view returns (address, bool);
    function getWinnerWeighted(address jurySC) external view returns (address, bool);
    function getWinnerWithScores(address jurySC) external view returns (address[] memory, uint256[] memory, uint256);

    // ========== Badge (PoB) ==========

    function pobAddress(address jurySC) external view returns (address);
    function getRoleOf(address jurySC, uint256 tokenId) external view returns (string memory);
    function claimed(address jurySC, uint256 tokenId) external view returns (bool);
    function ownerOfToken(address jurySC, uint256 tokenId) external view returns (address);
    function pobIteration(address jurySC) external view returns (uint256);
    function hasMintedBadge(address jurySC, address account) external view returns (bool);
}
