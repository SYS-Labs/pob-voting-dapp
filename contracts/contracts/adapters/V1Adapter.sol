// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IVersionAdapter.sol";

/**
 * @title IPoBRegistryOverrides
 * @notice Minimal interface for reading voting mode overrides from PoBRegistry
 */
interface IPoBRegistryOverrides {
    function votingModeOverride(address jurySC) external view returns (uint8);
}

/**
 * @title IJurySC_01_Base
 * @notice Minimal interface for JurySC_01 functions present in all deployed bytecodes
 */
interface IJurySC_01_Base {
    function pob() external view returns (address);
    function iteration() external view returns (uint256);
    function startTime() external view returns (uint64);
    function endTime() external view returns (uint64);
    function isActive() external view returns (bool);
    function hasVotingEnded() external view returns (bool);
    function votingEnded() external view returns (bool);
    function locked() external view returns (bool);
    function projectsLocked() external view returns (bool);
    function owner() external view returns (address);
    function projectCount() external view returns (uint256);
    function projectAddress(uint256 index) external view returns (address);
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
}

/**
 * @title IJurySC_01_Extended
 * @notice Extended interface for JurySC_01 functions added after initial deployment (v002+)
 */
interface IJurySC_01_Extended {
    function votingMode() external view returns (uint8);
    function getWinnerConsensus() external view returns (address, bool);
    function getWinnerWeighted() external view returns (address, bool);
    function getWinnerWithScores() external view returns (address[] memory, uint256[] memory, uint256);
}

/**
 * @title IPoB_01
 * @notice Interface for PoB_01 NFT contract
 */
interface IPoB_01 {
    function iteration() external view returns (uint256);
    function getRoleOf(uint256 tokenId) external view returns (string memory);
    function claimed(uint256 tokenId) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function hasMinted(address account) external view returns (bool);
}

/**
 * @title V1Adapter
 * @notice Stateless adapter implementing IVersionAdapter for JurySC_01/PoB_01.
 *         Handles v001 (initial deploy) and v002+ (upgraded with votingMode/consensus/weighted).
 *         Uses try-catch for extended functions that may not exist on v001 bytecode.
 */
contract V1Adapter is IVersionAdapter {
    error InvalidEntityId(uint8 entityId);

    address public immutable registry;

    constructor(address _registry) {
        registry = _registry;
    }

    // ========== Lifecycle ==========

    function iteration(address jurySC) external view override returns (uint256) {
        return IJurySC_01_Base(jurySC).iteration();
    }

    function startTime(address jurySC) external view override returns (uint64) {
        return IJurySC_01_Base(jurySC).startTime();
    }

    function endTime(address jurySC) external view override returns (uint64) {
        return IJurySC_01_Base(jurySC).endTime();
    }

    function isActive(address jurySC) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).isActive();
    }

    function hasVotingEnded(address jurySC) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).hasVotingEnded();
    }

    function votingEnded(address jurySC) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).votingEnded();
    }

    // ========== State ==========

    function locked(address jurySC) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).locked();
    }

    function projectsLocked(address jurySC) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).projectsLocked();
    }

    function votingMode(address jurySC) external view override returns (uint8) {
        // Check registry override first
        if (registry != address(0)) {
            try IPoBRegistryOverrides(registry).votingModeOverride(jurySC) returns (uint8 override_) {
                if (override_ > 0) return override_ - 1;
            } catch {}
        }
        // Fallback to contract call
        try IJurySC_01_Extended(jurySC).votingMode() returns (uint8 mode) {
            return mode;
        } catch {
            return 0; // CONSENSUS (default for v001)
        }
    }

    function owner(address jurySC) external view override returns (address) {
        return IJurySC_01_Base(jurySC).owner();
    }

    // ========== Projects ==========

    function getProjectAddresses(address jurySC) external view override returns (address[] memory) {
        IJurySC_01_Base jury = IJurySC_01_Base(jurySC);
        uint256 count = jury.projectCount();
        address[] memory addresses = new address[](count);
        for (uint256 i = 1; i <= count; i++) {
            addresses[i - 1] = jury.projectAddress(i);
        }
        return addresses;
    }

    function isRegisteredProject(address jurySC, address project) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).isRegisteredProject(project);
    }

    // ========== Entity-Generic ==========

    function getEntityVoters(address jurySC, uint8 entityId) external view override returns (address[] memory) {
        if (entityId == 0) {
            // DevRel: single account wrapped in array
            address devRel = IJurySC_01_Base(jurySC).devRelAccount();
            if (devRel == address(0)) {
                return new address[](0);
            }
            address[] memory voters = new address[](1);
            voters[0] = devRel;
            return voters;
        } else if (entityId == 1) {
            // DAO_HIC
            return IJurySC_01_Base(jurySC).getDaoHicVoters();
        }
        revert InvalidEntityId(entityId);
    }

    function entityVoteOf(address jurySC, uint8 entityId, address voter) external view override returns (address) {
        if (entityId == 0) {
            // DevRel
            IJurySC_01_Base jury = IJurySC_01_Base(jurySC);
            if (voter == jury.devRelAccount() && jury.devRelHasVoted()) {
                return jury.devRelVote();
            }
            return address(0);
        } else if (entityId == 1) {
            return IJurySC_01_Base(jurySC).daoHicVoteOf(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function entityHasVoted(address jurySC, uint8 entityId, address voter) external view override returns (bool) {
        if (entityId == 0) {
            IJurySC_01_Base jury = IJurySC_01_Base(jurySC);
            return voter == jury.devRelAccount() && jury.devRelHasVoted();
        } else if (entityId == 1) {
            return IJurySC_01_Base(jurySC).daoHicHasVoted(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function isEntityVoter(address jurySC, uint8 entityId, address voter) external view override returns (bool) {
        if (entityId == 0) {
            return IJurySC_01_Base(jurySC).isDevRelAccount(voter);
        } else if (entityId == 1) {
            return IJurySC_01_Base(jurySC).isDaoHicVoter(voter);
        }
        revert InvalidEntityId(entityId);
    }

    function getEntityVote(address jurySC, uint8 entityId) external view override returns (address) {
        if (entityId == 0) {
            return IJurySC_01_Base(jurySC).getDevRelEntityVote();
        } else if (entityId == 1) {
            return IJurySC_01_Base(jurySC).getDaoHicEntityVote();
        }
        revert InvalidEntityId(entityId);
    }

    // ========== Community ==========

    function communityVoteOf(address jurySC, uint256 tokenId) external view override returns (address) {
        return IJurySC_01_Base(jurySC).communityVoteOf(tokenId);
    }

    function communityHasVoted(address jurySC, uint256 tokenId) external view override returns (bool) {
        return IJurySC_01_Base(jurySC).communityHasVoted(tokenId);
    }

    function getCommunityEntityVote(address jurySC) external view override returns (address) {
        return IJurySC_01_Base(jurySC).getCommunityEntityVote();
    }

    // ========== Aggregates ==========

    function getVoteParticipationCounts(address jurySC) external view override returns (uint256, uint256, uint256) {
        return IJurySC_01_Base(jurySC).getVoteParticipationCounts();
    }

    function getProjectVoteBreakdown(address jurySC, address project) external view override returns (uint256, uint256) {
        return IJurySC_01_Base(jurySC).getProjectVoteBreakdown(project);
    }

    // ========== Results ==========

    function getWinner(address jurySC) external view override returns (address, bool) {
        // Check registry override for voting mode
        if (registry != address(0)) {
            try IPoBRegistryOverrides(registry).votingModeOverride(jurySC) returns (uint8 override_) {
                if (override_ > 0) {
                    uint8 mode = override_ - 1;
                    if (mode == 1) return this.getWinnerWeighted(jurySC);
                    if (mode == 0) return this.getWinnerConsensus(jurySC);
                }
            } catch {}
        }
        return IJurySC_01_Base(jurySC).getWinner();
    }

    function getWinnerConsensus(address jurySC) external view override returns (address, bool) {
        try IJurySC_01_Extended(jurySC).getWinnerConsensus() returns (address winner, bool hasWinner) {
            return (winner, hasWinner);
        } catch {
            // v001 fallback: getWinner() uses consensus by default
            return IJurySC_01_Base(jurySC).getWinner();
        }
    }

    function getWinnerWeighted(address jurySC) external view override returns (address, bool) {
        try IJurySC_01_Extended(jurySC).getWinnerWeighted() returns (address winner, bool hasWinner) {
            return (winner, hasWinner);
        } catch {
            // v001 has no weighted mode
            return (address(0), false);
        }
    }

    function getWinnerWithScores(address jurySC) external view override returns (
        address[] memory,
        uint256[] memory,
        uint256
    ) {
        try IJurySC_01_Extended(jurySC).getWinnerWithScores() returns (
            address[] memory projects,
            uint256[] memory scores,
            uint256 totalPossible
        ) {
            return (projects, scores, totalPossible);
        } catch {
            // v001 has no scores
            return (new address[](0), new uint256[](0), 0);
        }
    }

    // ========== Badge (PoB) ==========

    function pobAddress(address jurySC) external view override returns (address) {
        return address(IJurySC_01_Base(jurySC).pob());
    }

    function getRoleOf(address jurySC, uint256 tokenId) external view override returns (string memory) {
        return IPoB_01(address(IJurySC_01_Base(jurySC).pob())).getRoleOf(tokenId);
    }

    function claimed(address jurySC, uint256 tokenId) external view override returns (bool) {
        return IPoB_01(address(IJurySC_01_Base(jurySC).pob())).claimed(tokenId);
    }

    function ownerOfToken(address jurySC, uint256 tokenId) external view override returns (address) {
        return IPoB_01(address(IJurySC_01_Base(jurySC).pob())).ownerOf(tokenId);
    }

    function pobIteration(address jurySC) external view override returns (uint256) {
        return IPoB_01(address(IJurySC_01_Base(jurySC).pob())).iteration();
    }

    function hasMintedBadge(address jurySC, address account) external view override returns (bool) {
        return IPoB_01(address(IJurySC_01_Base(jurySC).pob())).hasMinted(account);
    }
}
