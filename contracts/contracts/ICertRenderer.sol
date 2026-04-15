// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct CertTemplateData {
    uint256 tokenId;
    uint256 iteration;
    string certType;
    string status;
    address account;
    string teamMembers;
}

interface ICertRenderer {
    function renderSVG(CertTemplateData memory data) external pure returns (string memory);
}
