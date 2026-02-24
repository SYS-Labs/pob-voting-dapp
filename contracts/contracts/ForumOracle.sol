// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ForumOracle
 * @notice Minimal gas-optimized contract for recording X posts with verification
 * @dev Stores post hashes on-chain for content verification
 */
contract ForumOracle is Ownable {
    // Simplified post record (minimal storage)
    struct PostRecord {
        bytes32 contentHash;  // SHA-256 hash of post content
        uint256 timestamp;    // Block timestamp
        uint256 blockNumber;  // Block number when recorded
        bool exists;          // Existence flag
    }

    // State variables
    /// @dev Advisory-only metadata: managed by owner, but NOT enforced in recordPost/recordResponse.
    ///      The oracle service is expected to pre-filter posts by trusted usernames off-chain
    ///      before submitting transactions. On-chain enforcement would require passing the
    ///      author username as a parameter, which is intentionally omitted to keep gas minimal.
    mapping(string => bool) public trustedUsers;
    mapping(string => PostRecord) public posts;            // X post ID => record
    mapping(string => string) public sourcePostResponses;  // Source post ID => reply post ID
    mapping(string => bool) public hasReceivedResponse;    // Source post ID => has response
    address public oracleAddress;                          // Authorized oracle

    // Events
    event TrustedUserAdded(string indexed xUsername);
    event PostRecorded(string indexed postId, bytes32 contentHash, uint256 timestamp);
    event ResponseRecorded(string indexed sourcePostId, string indexed replyPostId, bytes32 contentHash, uint256 timestamp);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // Modifiers
    modifier onlyOracle() {
        require(msg.sender == oracleAddress, "Only oracle can call");
        _;
    }

    /**
     * @dev Constructor sets initial oracle address
     * @param _oracleAddress Address authorized to record posts
     */
    constructor(address _oracleAddress) Ownable(msg.sender) {
        require(_oracleAddress != address(0), "Invalid oracle address");
        oracleAddress = _oracleAddress;
    }

    // ========== TRUSTED USER MANAGEMENT ==========

    /**
     * @notice Add a trusted X username (owner only)
     * @param xUsername X username to trust
     */
    function addTrustedUser(string memory xUsername) external onlyOwner {
        require(!trustedUsers[xUsername], "User already trusted");
        trustedUsers[xUsername] = true;
        emit TrustedUserAdded(xUsername);
    }

    /**
     * @notice Check if X username is trusted
     * @param xUsername X username to check
     * @return bool True if trusted
     */
    function isTrustedUser(string memory xUsername) public view returns (bool) {
        return trustedUsers[xUsername];
    }

    // ========== POST RECORDING ==========

    /**
     * @notice Record a post with content hash (oracle only)
     * @dev Legacy function for backward compatibility - records standalone posts
     * @param postId X post ID
     * @param contentHash SHA-256 hash of post content
     */
    function recordPost(string memory postId, bytes32 contentHash) external onlyOracle {
        require(!posts[postId].exists, "Post already recorded");
        require(contentHash != bytes32(0), "Invalid hash");

        posts[postId] = PostRecord({
            contentHash: contentHash,
            timestamp: block.timestamp,
            blockNumber: block.number,
            exists: true
        });

        emit PostRecorded(postId, contentHash, block.timestamp);
    }

    /**
     * @notice Record a reply post with source post tracking (oracle only)
     * @dev Enforces one response per source post to prevent duplicate bot replies
     * @param replyPostId X post ID of the reply
     * @param sourcePostId X post ID being replied to
     * @param contentHash SHA-256 hash of reply content
     */
    function recordResponse(
        string memory replyPostId,
        string memory sourcePostId,
        bytes32 contentHash
    ) external onlyOracle {
        require(!posts[replyPostId].exists, "Reply already recorded");
        require(contentHash != bytes32(0), "Invalid hash");
        require(!hasReceivedResponse[sourcePostId], "Source post already has a response");

        // Record the reply post
        posts[replyPostId] = PostRecord({
            contentHash: contentHash,
            timestamp: block.timestamp,
            blockNumber: block.number,
            exists: true
        });

        // Track the response relationship
        sourcePostResponses[sourcePostId] = replyPostId;
        hasReceivedResponse[sourcePostId] = true;

        emit ResponseRecorded(sourcePostId, replyPostId, contentHash, block.timestamp);
    }

    /**
     * @notice Check if a source post has received a response
     * @param sourcePostId X post ID to check
     * @return bool True if the post has received a response
     */
    function hasResponse(string memory sourcePostId) public view returns (bool) {
        return hasReceivedResponse[sourcePostId];
    }

    /**
     * @notice Get the reply post ID for a source post
     * @param sourcePostId X post ID to look up
     * @return string Reply post ID (empty if no response)
     */
    function getResponse(string memory sourcePostId) public view returns (string memory) {
        return sourcePostResponses[sourcePostId];
    }

    // ========== FINALITY ==========

    /**
     * @notice Check if a post is final (10+ blocks deep)
     * @param postId X post ID to check
     * @return bool True if post has 10+ confirmations
     */
    function isPostFinal(string memory postId) public view returns (bool) {
        if (!posts[postId].exists) return false;
        return block.number >= posts[postId].blockNumber + 10;
    }

    /**
     * @notice Get the number of confirmations for a post
     * @param postId X post ID to check
     * @return uint256 Number of confirmations (0 if post doesn't exist)
     */
    function getConfirmations(string memory postId) public view returns (uint256) {
        if (!posts[postId].exists) return 0;
        if (block.number < posts[postId].blockNumber) return 0;
        return block.number - posts[postId].blockNumber + 1;
    }

    /**
     * @notice Check if a response is final (10+ blocks deep)
     * @param sourcePostId Source post ID to check
     * @return bool True if response exists and has 10+ confirmations
     */
    function isResponseFinal(string memory sourcePostId) public view returns (bool) {
        if (!hasReceivedResponse[sourcePostId]) return false;
        string memory replyId = sourcePostResponses[sourcePostId];
        return isPostFinal(replyId);
    }

    // ========== VERIFICATION ==========

    /**
     * @notice Verify post content matches recorded hash
     * @param postId X post ID
     * @param content Original post content
     * @return bool True if content matches recorded hash
     */
    function verifyPost(string memory postId, string memory content)
        public
        view
        returns (bool)
    {
        if (!posts[postId].exists) return false;
        bytes32 computedHash = sha256(bytes(content));
        return posts[postId].contentHash == computedHash;
    }

    /**
     * @notice Get post record details
     * @param postId X post ID
     * @return PostRecord struct with hash, timestamp, exists
     */
    function getPostRecord(string memory postId)
        external
        view
        returns (PostRecord memory)
    {
        require(posts[postId].exists, "Post not found");
        return posts[postId];
    }

    // ========== ORACLE MANAGEMENT ==========

    /**
     * @notice Update oracle address (owner only)
     * @param newOracle New oracle address
     */
    function updateOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle address");
        address oldOracle = oracleAddress;
        oracleAddress = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }
}
