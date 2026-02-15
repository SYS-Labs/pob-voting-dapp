// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IVersionAdapter.sol";

/**
 * @title IJurySC_02_Full
 * @notice Interface for JurySC_02 — has all functions natively (no try-catch needed)
 */
interface IJurySC_02_Full {
    function pob() external view returns (address);
    function iteration() external view returns (uint256);
    function startTime() external view returns (uint64);
    function endTime() external view returns (uint64);
    function isActive() external view returns (bool);
    function hasVotingEnded() external view returns (bool);
    function votingEnded() external view returns (bool);
    function locked() external view returns (bool);
    function projectsLocked() external view returns (bool);
    function votingMode() external view returns (uint8);
    function owner() external view returns (address);
    function getProjectAddresses() external view returns (address[] memory);
    function isRegisteredProject(address project) external view returns (bool);
    function devRelAccount() external view returns (address);
    function devRelVote() external view returns (address);
    function devRelHasVoted() external view returns (bool);
    function isDevRelAccount(address account) external view returns (bool);
    function getDevRelEntityVote() external view returns (address);
    function isDaoHicVoter(address voter) external view returns (bool);
    function getDaoHicVoters() external view returns (address[] memory);
    function daoHicVoteOf(address voter) external view returns (address);
    function daoHicHasVoted(address voter) external view returns (bool);
    function getDaoHicEntityVote() external view returns (address);
    function communityVoteOf(uint256 tokenId) external view returns (address);
    function communityHasVoted(uint256 tokenId) external view returns (bool);
    function getCommunityEntityVote() external view returns (address);
    function getVoteParticipationCounts() external view returns (uint256, uint256, uint256);
    function getProjectVoteBreakdown(address project) external view returns (uint256, uint256);
    function getWinner() external view returns (address, bool);
    function getWinnerConsensus() external view returns (address, bool);
    function getWinnerWeighted() external view returns (address, bool);
    function getWinnerWithScores() external view returns (address[] memory, uint256[] memory, uint256);
}

/**
 * @title IPoB_02
 * @notice Interface for PoB_02 NFT contract
 */
interface IPoB_02 {
    function iteration() external view returns (uint256);
    function getRoleOf(uint256 tokenId) external view returns (string memory);
    function claimed(uint256 tokenId) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function hasMintedBadge(address account) external view returns (bool);
}

/**
 * @title V2Adapter
 * @notice Stateless adapter implementing IVersionAdapter for JurySC_02/PoB_02.
 *         Thinner than V1Adapter — JurySC_02 has all functions natively.
 *         Only entity-generic wrapping and hasMintedBadge naming differ.
 */
contract V2Adapter is IVersionAdapter {
    error InvalidEntityId(uint8 entityId);

    // ========== Lifecycle ==========

    function iteration(address jurySC) external view override returns (uint256) {
        return IJurySC_02_Full(jurySC).iteration();
    }

    function startTime(address jurySC) external view override returns (uint64) {
        return IJurySC_02_Full(jurySC).startTime();
    }

    function endTime(address jurySC) external view override returns (uint64) {
        return IJurySC_02_Full(jurySC).endTime();
    }

    function isActive(address jurySC) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).isActive();
    }

    function hasVotingEnded(address jurySC) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).hasVotingEnded();
    }

    function votingEnded(address jurySC) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).votingEnded();
    }

    // ========== State ==========

    function locked(address jurySC) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).locked();
    }

    function projectsLocked(address jurySC) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).projectsLocked();
    }

    function votingMode(address jurySC) external view override returns (uint8) {
        return IJurySC_02_Full(jurySC).votingMode();
    }

    function owner(address jurySC) external view override returns (address) {
        return IJurySC_02_Full(jurySC).owner();
    }

    // ========== Projects ==========

    function getProjectAddresses(address jurySC) external view override returns (address[] memory) {
        return IJurySC_02_Full(jurySC).getProjectAddresses();
    }

    function isRegisteredProject(address jurySC, address project) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).isRegisteredProject(project);
    }

    // ========== Entity-Generic ==========

    function getEntityVoters(address jurySC, uint8 entityId) external view override returns (address[] memory) {
        if (entityId == 0) {
            address devRel = IJurySC_02_Full(jurySC).devRelAccount();
            if (devRel == address(0)) {
                return new address[](0);
            }
            address[] memory voters = new address[](1);
            voters[0] = devRel;
            return voters;
        } else if (entityId == 1) {
            return IJurySC_02_Full(jurySC).getDaoHicVoters();
        }
        revert InvalidEntityId(entityId);
    }

    function entityVoteOf(address jurySC, uint8 entityId, address voter) external view override returns (address) {
        if (entityId == 0) {
            IJurySC_02_Full jury = IJurySC_02_Full(jurySC);
            if (voter == jury.devRelAccount() && jury.devRelHasVoted()) {
                return jury.devRelVote();
            }
            return address(0);
        } else if (entityId == 1) {
            return IJurySC_02_Full(jurySC).daoHicVoteOf(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function entityHasVoted(address jurySC, uint8 entityId, address voter) external view override returns (bool) {
        if (entityId == 0) {
            IJurySC_02_Full jury = IJurySC_02_Full(jurySC);
            return voter == jury.devRelAccount() && jury.devRelHasVoted();
        } else if (entityId == 1) {
            return IJurySC_02_Full(jurySC).daoHicHasVoted(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function isEntityVoter(address jurySC, uint8 entityId, address voter) external view override returns (bool) {
        if (entityId == 0) {
            return IJurySC_02_Full(jurySC).isDevRelAccount(voter);
        } else if (entityId == 1) {
            return IJurySC_02_Full(jurySC).isDaoHicVoter(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function getEntityVote(address jurySC, uint8 entityId) external view override returns (address) {
        if (entityId == 0) {
            return IJurySC_02_Full(jurySC).getDevRelEntityVote();
        } else if (entityId == 1) {
            return IJurySC_02_Full(jurySC).getDaoHicEntityVote();
        }
        revert InvalidEntityId(entityId);
    }

    // ========== Community ==========

    function communityVoteOf(address jurySC, uint256 tokenId) external view override returns (address) {
        return IJurySC_02_Full(jurySC).communityVoteOf(tokenId);
    }

    function communityHasVoted(address jurySC, uint256 tokenId) external view override returns (bool) {
        return IJurySC_02_Full(jurySC).communityHasVoted(tokenId);
    }

    function getCommunityEntityVote(address jurySC) external view override returns (address) {
        return IJurySC_02_Full(jurySC).getCommunityEntityVote();
    }

    // ========== Aggregates ==========

    function getVoteParticipationCounts(address jurySC) external view override returns (uint256, uint256, uint256) {
        return IJurySC_02_Full(jurySC).getVoteParticipationCounts();
    }

    function getProjectVoteBreakdown(address jurySC, address project) external view override returns (uint256, uint256) {
        return IJurySC_02_Full(jurySC).getProjectVoteBreakdown(project);
    }

    // ========== Results ==========

    function getWinner(address jurySC) external view override returns (address, bool) {
        return IJurySC_02_Full(jurySC).getWinner();
    }

    function getWinnerConsensus(address jurySC) external view override returns (address, bool) {
        return IJurySC_02_Full(jurySC).getWinnerConsensus();
    }

    function getWinnerWeighted(address jurySC) external view override returns (address, bool) {
        return IJurySC_02_Full(jurySC).getWinnerWeighted();
    }

    function getWinnerWithScores(address jurySC) external view override returns (
        address[] memory,
        uint256[] memory,
        uint256
    ) {
        return IJurySC_02_Full(jurySC).getWinnerWithScores();
    }

    // ========== Badge (PoB) ==========

    function pobAddress(address jurySC) external view override returns (address) {
        return address(IJurySC_02_Full(jurySC).pob());
    }

    function getRoleOf(address jurySC, uint256 tokenId) external view override returns (string memory) {
        return IPoB_02(address(IJurySC_02_Full(jurySC).pob())).getRoleOf(tokenId);
    }

    function claimed(address jurySC, uint256 tokenId) external view override returns (bool) {
        return IPoB_02(address(IJurySC_02_Full(jurySC).pob())).claimed(tokenId);
    }

    function ownerOfToken(address jurySC, uint256 tokenId) external view override returns (address) {
        return IPoB_02(address(IJurySC_02_Full(jurySC).pob())).ownerOf(tokenId);
    }

    function pobIteration(address jurySC) external view override returns (uint256) {
        return IPoB_02(address(IJurySC_02_Full(jurySC).pob())).iteration();
    }

    function hasMintedBadge(address jurySC, address account) external view override returns (bool) {
        return IPoB_02(address(IJurySC_02_Full(jurySC).pob())).hasMintedBadge(account);
    }
}
