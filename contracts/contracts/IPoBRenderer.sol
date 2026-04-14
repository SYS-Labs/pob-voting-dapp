// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct PoBTemplateData {
    uint256 tokenId;
    uint256 iteration;
    string role;
}

interface IPoBRenderer {
    function renderSVG(PoBTemplateData memory data) external pure returns (string memory);
}
