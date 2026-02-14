// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ICertMiddleware.sol";

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

/**
 * @title MockCertMiddleware
 * @notice Mock middleware for testing CertNFT team member features
 */
contract MockCertMiddleware is ICertMiddleware {
    mapping(address => bool) private _eligible;
    mapping(address => string) private _certType;
    mapping(address => bool) private _isProject;
    string private _templateCID;

    function setEligible(address account, bool eligible_, string calldata certType_) external {
        _eligible[account] = eligible_;
        _certType[account] = certType_;
    }

    function setIsProject(address account, bool value) external {
        _isProject[account] = value;
    }

    function setTemplateCID(string calldata cid) external {
        _templateCID = cid;
    }

    function validate(address account) external view override returns (bool eligible, string memory certType) {
        return (_eligible[account], _certType[account]);
    }

    function templateCID() external view override returns (string memory) {
        return _templateCID;
    }

    function isProjectInAnyRound(address account) external view override returns (bool) {
        return _isProject[account];
    }
}
