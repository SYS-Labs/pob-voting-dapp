// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPoB
 * @notice Mock PoB badge contract for testing CertMiddleware
 */
contract MockPoB {
    mapping(address => bool) public hasMinted;

    function setHasMinted(address account, bool value) external {
        hasMinted[account] = value;
    }
}

/**
 * @title MockJurySCForCert
 * @notice Mock JurySC contract for testing CertMiddleware
 */
contract MockJurySCForCert {
    bool private _hasVotingEnded;
    address private _winnerAddr;
    bool private _hasWinner;

    mapping(address => bool) private _isDevRel;
    mapping(address => bool) private _isDaoHic;
    mapping(address => bool) private _isProject;

    function setHasVotingEnded(bool value) external {
        _hasVotingEnded = value;
    }

    function setWinner(address addr, bool hasWin) external {
        _winnerAddr = addr;
        _hasWinner = hasWin;
    }

    function setIsDevRelAccount(address account, bool value) external {
        _isDevRel[account] = value;
    }

    function setIsDaoHicVoter(address account, bool value) external {
        _isDaoHic[account] = value;
    }

    function setIsRegisteredProject(address account, bool value) external {
        _isProject[account] = value;
    }

    // IJurySCForCert interface
    function hasVotingEnded() external view returns (bool) {
        return _hasVotingEnded;
    }

    function getWinner() external view returns (address, bool) {
        return (_winnerAddr, _hasWinner);
    }

    function isDevRelAccount(address account) external view returns (bool) {
        return _isDevRel[account];
    }

    function isDaoHicVoter(address account) external view returns (bool) {
        return _isDaoHic[account];
    }

    function isRegisteredProject(address account) external view returns (bool) {
        return _isProject[account];
    }
}
