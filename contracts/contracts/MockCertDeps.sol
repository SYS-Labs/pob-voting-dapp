// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ICertGate.sol";

/**
 * @title MockPoB
 * @notice Mock PoB badge contract for testing CertGate
 */
contract MockPoB {
    mapping(address => bool) public hasMinted;

    function setHasMinted(address account, bool value) external {
        hasMinted[account] = value;
    }
}

/**
 * @title MockJurySCForCert
 * @notice Mock JurySC contract for testing CertGate
 */
contract MockJurySCForCert {
    bool private _hasVotingEnded;
    address private _winnerAddr;
    bool private _hasWinner;

    mapping(address => bool) private _isDevRel;
    mapping(address => bool) private _isDaoHic;
    mapping(address => bool) private _isSmt;
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

    function setIsSmtVoter(address account, bool value) external {
        _isSmt[account] = value;
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

    function isSmtVoter(address account) external view returns (bool) {
        return _isSmt[account];
    }

    function isRegisteredProject(address account) external view returns (bool) {
        return _isProject[account];
    }
}

/**
 * @title MockCertGate
 * @notice Mock gate for testing CertNFT team member and cert request features.
 *         Template storage has moved to PoBRegistry; use MockPoBRegistry for template tests.
 */
contract MockCertGate is ICertGate {
    mapping(address => bool) private _eligible;
    mapping(address => string) private _certType;
    mapping(address => bool) private _isProject;

    function setEligible(address account, bool eligible_, string calldata certType_) external {
        _eligible[account] = eligible_;
        _certType[account] = certType_;
    }

    function setIsProject(address account, bool value) external {
        _isProject[account] = value;
    }

    function validate(address account) external view override returns (bool eligible, string memory certType) {
        return (_eligible[account], _certType[account]);
    }

    function isProjectInAnyRound(address account) external view override returns (bool) {
        return _isProject[account];
    }
}

/**
 * @title MockPoBRegistry
 * @notice Mock PoBRegistry for testing CertNFT renderSVG and tokenURI template lookups.
 */
contract MockPoBRegistry {
    struct MockTemplate {
        bytes32 hash;
        uint32 version;
        string cid;
    }

    mapping(uint256 => MockTemplate) private _templates;

    function setTemplate(uint256 iterationId, bytes32 hash, string calldata cid) external {
        _templates[iterationId].version++;
        _templates[iterationId].hash = hash;
        _templates[iterationId].cid = cid;
    }

    function getIterationTemplate(uint256 iterationId)
        external
        view
        returns (bytes32 hash, uint32 version, string memory cid)
    {
        MockTemplate storage t = _templates[iterationId];
        return (t.hash, t.version, t.cid);
    }
}
