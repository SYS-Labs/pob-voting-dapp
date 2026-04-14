// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";
import "./IPoBRenderer.sol";

contract PoBRenderer_01 is IPoBRenderer {
    using Strings for uint256;

    function renderSVG(PoBTemplateData memory data) external pure override returns (string memory) {
        string memory accent = _accentForRole(data.role);
        return string(abi.encodePacked(_defs(accent), _hero(data, accent), _footer(data, accent)));
    }

    function _defs(string memory accent) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\" fill=\"none\">",
                "<defs>",
                "<linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
                "<stop offset=\"0%\" stop-color=\"#07111F\"/>",
                "<stop offset=\"100%\" stop-color=\"#13233C\"/>",
                "</linearGradient>",
                "<linearGradient id=\"panel\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
                "<stop offset=\"0%\" stop-color=\"#FFFFFF\" stop-opacity=\"0.16\"/>",
                "<stop offset=\"100%\" stop-color=\"#FFFFFF\" stop-opacity=\"0.04\"/>",
                "</linearGradient>",
                "</defs>",
                "<rect width=\"800\" height=\"800\" rx=\"48\" fill=\"url(#bg)\"/>",
                "<circle cx=\"650\" cy=\"148\" r=\"184\" fill=\"", accent, "\" fill-opacity=\"0.18\"/>",
                "<circle cx=\"128\" cy=\"702\" r=\"216\" fill=\"#FFFFFF\" fill-opacity=\"0.05\"/>",
                "<rect x=\"48\" y=\"48\" width=\"704\" height=\"704\" rx=\"36\" fill=\"url(#panel)\" stroke=\"#FFFFFF\" stroke-opacity=\"0.12\"/>"
            )
        );
    }

    function _hero(PoBTemplateData memory data, string memory accent) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "<rect x=\"82\" y=\"88\" width=\"188\" height=\"36\" rx=\"18\" fill=\"", accent, "\"/>",
                "<text x=\"106\" y=\"112\" fill=\"#07111F\" font-family=\"monospace\" font-size=\"18\" font-weight=\"700\">POB BADGE</text>",
                "<text x=\"84\" y=\"232\" fill=\"#F7FAFC\" font-family=\"monospace\" font-size=\"66\" font-weight=\"700\">", data.role, "</text>",
                "<text x=\"84\" y=\"292\" fill=\"#A9B7CC\" font-family=\"monospace\" font-size=\"28\">Iteration #", data.iteration.toString(), "</text>",
                "<path d=\"M84 360H716\" stroke=\"#FFFFFF\" stroke-opacity=\"0.14\"/>",
                "<path d=\"M84 410C190 364 302 364 408 410C514 456 626 456 716 410V566C626 612 514 612 408 566C302 520 190 520 84 566V410Z\" fill=\"", accent, "\" fill-opacity=\"0.25\"/>",
                "<path d=\"M84 470C190 424 302 424 408 470C514 516 626 516 716 470\" stroke=\"#FFFFFF\" stroke-opacity=\"0.24\" stroke-width=\"4\"/>"
            )
        );
    }

    function _footer(PoBTemplateData memory data, string memory accent) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "<text x=\"84\" y=\"636\" fill=\"#F7FAFC\" font-family=\"monospace\" font-size=\"24\">Token #", data.tokenId.toString(), "</text>",
                "<text x=\"84\" y=\"680\" fill=\"#A9B7CC\" font-family=\"monospace\" font-size=\"18\">Proof of Builders</text>",
                "<rect x=\"604\" y=\"620\" width=\"112\" height=\"36\" rx=\"18\" fill=\"", accent, "\" fill-opacity=\"0.18\"/>",
                "</svg>"
            )
        );
    }

    function _accentForRole(string memory role) internal pure returns (string memory) {
        bytes32 roleHash = keccak256(bytes(role));
        if (roleHash == keccak256(bytes("Community"))) return "#F4D35E";
        if (roleHash == keccak256(bytes("DAO-HIC"))) return "#57CC99";
        if (roleHash == keccak256(bytes("SMT"))) return "#70A1FF";
        if (roleHash == keccak256(bytes("Project"))) return "#FF8C69";
        if (roleHash == keccak256(bytes("DevRel"))) return "#B388EB";
        return "#D9E2EC";
    }
}
