// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";
import "./ICertRenderer.sol";

contract CertRenderer_01 is ICertRenderer {
    using Strings for uint256;

    function renderSVG(CertTemplateData memory data) external pure override returns (string memory) {
        string memory accent = _accentForType(data.certType);
        return string(abi.encodePacked(_defs(accent), _header(data, accent), _body(data, accent), _footer(data, accent), "</svg>"));
    }

    function _defs(string memory accent) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1200 800\" fill=\"none\">",
            "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0B1020\"/><stop offset=\"100%\" stop-color=\"#172033\"/></linearGradient>",
            "<linearGradient id=\"paper\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#F8FAFC\"/><stop offset=\"100%\" stop-color=\"#DDE6F0\"/></linearGradient></defs>",
            "<rect width=\"1200\" height=\"800\" rx=\"44\" fill=\"url(#bg)\"/>",
            "<circle cx=\"1040\" cy=\"110\" r=\"240\" fill=\"", accent, "\" fill-opacity=\"0.20\"/>",
            "<circle cx=\"130\" cy=\"720\" r=\"220\" fill=\"#5EEAD4\" fill-opacity=\"0.10\"/>",
            "<rect x=\"70\" y=\"70\" width=\"1060\" height=\"660\" rx=\"34\" fill=\"url(#paper)\"/>",
            "<rect x=\"96\" y=\"96\" width=\"1008\" height=\"608\" rx=\"24\" stroke=\"#0B1020\" stroke-opacity=\"0.16\" stroke-width=\"2\"/>"
        ));
    }

    function _header(CertTemplateData memory data, string memory accent) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<rect x=\"126\" y=\"126\" width=\"214\" height=\"42\" rx=\"8\" fill=\"", accent, "\"/>",
            "<text x=\"148\" y=\"154\" fill=\"#07111F\" font-family=\"monospace\" font-size=\"20\" font-weight=\"700\">POB CERTIFICATE</text>",
            "<text x=\"126\" y=\"246\" fill=\"#0B1020\" font-family=\"monospace\" font-size=\"62\" font-weight=\"700\">", _xmlEscape(data.certType), "</text>",
            "<text x=\"128\" y=\"294\" fill=\"#334155\" font-family=\"monospace\" font-size=\"28\">Iteration #", data.iteration.toString(), "</text>",
            "<path d=\"M126 330H1074\" stroke=\"#0B1020\" stroke-opacity=\"0.14\"/>"
        ));
    }

    function _body(CertTemplateData memory data, string memory accent) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<text x=\"126\" y=\"394\" fill=\"#475569\" font-family=\"monospace\" font-size=\"22\">Recipient</text>",
            "<text x=\"126\" y=\"436\" fill=\"#0B1020\" font-family=\"monospace\" font-size=\"24\">", _addressToString(data.account), "</text>",
            "<text x=\"126\" y=\"506\" fill=\"#475569\" font-family=\"monospace\" font-size=\"22\">Team</text>",
            "<text x=\"126\" y=\"548\" fill=\"#0B1020\" font-family=\"monospace\" font-size=\"24\">", _teamText(data.teamMembers), "</text>",
            "<rect x=\"784\" y=\"374\" width=\"250\" height=\"250\" rx=\"22\" fill=\"", accent, "\" fill-opacity=\"0.18\"/>",
            "<path d=\"M848 492L895 539L982 438\" stroke=\"", accent, "\" stroke-width=\"24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
        ));
    }

    function _footer(CertTemplateData memory data, string memory accent) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<path d=\"M126 606H1074\" stroke=\"#0B1020\" stroke-opacity=\"0.14\"/>",
            "<text x=\"126\" y=\"660\" fill=\"#0B1020\" font-family=\"monospace\" font-size=\"24\">Token #", data.tokenId.toString(), "</text>",
            "<rect x=\"870\" y=\"630\" width=\"164\" height=\"42\" rx=\"8\" fill=\"", accent, "\"/>",
            "<text x=\"900\" y=\"658\" fill=\"#07111F\" font-family=\"monospace\" font-size=\"20\" font-weight=\"700\">", _xmlEscape(data.status), "</text>"
        ));
    }

    function _teamText(string memory teamMembers) internal pure returns (string memory) {
        if (bytes(teamMembers).length == 0) return "Not applicable";
        return _xmlEscape(teamMembers);
    }

    function _accentForType(string memory certType) internal pure returns (string memory) {
        bytes32 typeHash = keccak256(bytes(certType));
        if (typeHash == keccak256(bytes("winner"))) return "#F4D35E";
        if (typeHash == keccak256(bytes("organizer"))) return "#57CC99";
        if (typeHash == keccak256(bytes("speaker"))) return "#70A1FF";
        if (typeHash == keccak256(bytes("participant"))) return "#FF8C69";
        return "#9AE6B4";
    }

    function _xmlEscape(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        uint256 extra = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") extra += 4;
            else if (c == "<") extra += 3;
            else if (c == ">") extra += 3;
            else if (c == bytes1(0x22)) extra += 5;
            else if (c == bytes1(0x27)) extra += 5;
        }
        if (extra == 0) return input;

        bytes memory result = new bytes(b.length + extra);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") {
                result[j++] = "&"; result[j++] = "a"; result[j++] = "m"; result[j++] = "p"; result[j++] = ";";
            } else if (c == "<") {
                result[j++] = "&"; result[j++] = "l"; result[j++] = "t"; result[j++] = ";";
            } else if (c == ">") {
                result[j++] = "&"; result[j++] = "g"; result[j++] = "t"; result[j++] = ";";
            } else if (c == bytes1(0x22)) {
                result[j++] = "&"; result[j++] = "q"; result[j++] = "u"; result[j++] = "o"; result[j++] = "t"; result[j++] = ";";
            } else if (c == bytes1(0x27)) {
                result[j++] = "&"; result[j++] = "a"; result[j++] = "p"; result[j++] = "o"; result[j++] = "s"; result[j++] = ";";
            } else {
                result[j++] = c;
            }
        }
        return string(result);
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory result = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        bytes memory alphabet = "0123456789abcdef";
        uint160 value = uint160(addr);
        for (uint256 i = 41; i >= 2; i--) {
            result[i] = alphabet[value & 0xf];
            value >>= 4;
        }
        return string(result);
    }
}
