// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockJurySC
 * @notice Mock JurySC contract for testing PoBRegistry time window validation
 */
contract MockJurySC {
    mapping(address => bool) public isRegisteredProject;
    bool public projectsLocked;
    bool public locked;

    function registerProject(address projectAddress) external {
        isRegisteredProject[projectAddress] = true;
    }

    function lockProjects() external {
        projectsLocked = true;
    }

    function unlockProjects() external {
        projectsLocked = false;
    }

    function lockContractForHistory() external {
        locked = true;
    }

    function unlockContract() external {
        locked = false;
    }
}
