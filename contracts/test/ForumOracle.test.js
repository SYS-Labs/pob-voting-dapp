import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";

const { ethers } = hre;

describe("ForumOracle", function () {
  // Fixture to deploy contract and set up test accounts
  async function deployForumOracleFixture() {
    const [owner, oracle, otherAccount, notOracle] = await ethers.getSigners();

    const ForumOracle = await ethers.getContractFactory("ForumOracle");
    const forumOracle = await ForumOracle.deploy(oracle.address);

    // Sample data
    const postId = "1234567890123456789";
    const replyId = "9876543210987654321";
    const sourceId = "5555555555555555555";
    const content = "Hello, World!";
    const contentHash = ethers.sha256(ethers.toUtf8Bytes(content));

    return {
      forumOracle,
      owner,
      oracle,
      otherAccount,
      notOracle,
      postId,
      replyId,
      sourceId,
      content,
      contentHash
    };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { forumOracle, owner } = await loadFixture(deployForumOracleFixture);
      expect(await forumOracle.owner()).to.equal(owner.address);
    });

    it("Should set the correct oracle address", async function () {
      const { forumOracle, oracle } = await loadFixture(deployForumOracleFixture);
      expect(await forumOracle.oracleAddress()).to.equal(oracle.address);
    });

    it("Should revert if oracle address is zero", async function () {
      const ForumOracle = await ethers.getContractFactory("ForumOracle");
      await expect(
        ForumOracle.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid oracle address");
    });
  });

  describe("Trusted User Management", function () {
    it("Should allow owner to add trusted user", async function () {
      const { forumOracle, owner } = await loadFixture(deployForumOracleFixture);

      await expect(forumOracle.connect(owner).addTrustedUser("alice"))
        .to.emit(forumOracle, "TrustedUserAdded")
        .withArgs("alice");

      expect(await forumOracle.isTrustedUser("alice")).to.be.true;
    });

    it("Should not allow non-owner to add trusted user", async function () {
      const { forumOracle, otherAccount } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(otherAccount).addTrustedUser("alice")
      ).to.be.revertedWithCustomError(forumOracle, "OwnableUnauthorizedAccount");
    });

    it("Should not allow adding same user twice", async function () {
      const { forumOracle, owner } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(owner).addTrustedUser("alice");

      await expect(
        forumOracle.connect(owner).addTrustedUser("alice")
      ).to.be.revertedWith("User already trusted");
    });

    it("Should return false for non-trusted users", async function () {
      const { forumOracle } = await loadFixture(deployForumOracleFixture);
      expect(await forumOracle.isTrustedUser("bob")).to.be.false;
    });
  });

  describe("Post Recording", function () {
    it("Should allow oracle to record a post", async function () {
      const { forumOracle, oracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      await expect(forumOracle.connect(oracle).recordPost(postId, contentHash))
        .to.emit(forumOracle, "PostRecorded")
        .withArgs(postId, contentHash, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));

      const post = await forumOracle.getPostRecord(postId);
      expect(post.contentHash).to.equal(contentHash);
      expect(post.exists).to.be.true;
      expect(post.blockNumber).to.be.greaterThan(0);
    });

    it("Should not allow non-oracle to record a post", async function () {
      const { forumOracle, notOracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(notOracle).recordPost(postId, contentHash)
      ).to.be.revertedWith("Only oracle can call");
    });

    it("Should not allow recording same post twice", async function () {
      const { forumOracle, oracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(oracle).recordPost(postId, contentHash);

      await expect(
        forumOracle.connect(oracle).recordPost(postId, contentHash)
      ).to.be.revertedWith("Post already recorded");
    });

    it("Should not allow zero hash", async function () {
      const { forumOracle, oracle, postId } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(oracle).recordPost(postId, ethers.ZeroHash)
      ).to.be.revertedWith("Invalid hash");
    });

    it("Should revert when getting non-existent post", async function () {
      const { forumOracle } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.getPostRecord("nonexistent")
      ).to.be.revertedWith("Post not found");
    });
  });

  describe("Response Recording", function () {
    it("Should allow oracle to record a response", async function () {
      const { forumOracle, oracle, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      await expect(forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash))
        .to.emit(forumOracle, "ResponseRecorded")
        .withArgs(sourceId, replyId, contentHash, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));

      // Verify reply post was recorded
      const replyPost = await forumOracle.getPostRecord(replyId);
      expect(replyPost.contentHash).to.equal(contentHash);
      expect(replyPost.exists).to.be.true;

      // Verify response tracking
      expect(await forumOracle.hasResponse(sourceId)).to.be.true;
      expect(await forumOracle.getResponse(sourceId)).to.equal(replyId);
    });

    it("Should not allow non-oracle to record a response", async function () {
      const { forumOracle, notOracle, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(notOracle).recordResponse(replyId, sourceId, contentHash)
      ).to.be.revertedWith("Only oracle can call");
    });

    it("Should not allow recording same reply twice", async function () {
      const { forumOracle, oracle, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash);

      const replyId2 = "1111111111111111111";
      await expect(
        forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash)
      ).to.be.revertedWith("Reply already recorded");
    });

    it("Should enforce one response per source post", async function () {
      const { forumOracle, oracle, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      // Record first response
      await forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash);

      // Try to record second response to same source post
      const replyId2 = "1111111111111111111";
      const contentHash2 = ethers.sha256(ethers.toUtf8Bytes("Second reply"));

      await expect(
        forumOracle.connect(oracle).recordResponse(replyId2, sourceId, contentHash2)
      ).to.be.revertedWith("Source post already has a response");
    });

    it("Should allow different replies to different source posts", async function () {
      const { forumOracle, oracle, contentHash } = await loadFixture(deployForumOracleFixture);

      const sourceId1 = "1000000000000000001";
      const replyId1 = "2000000000000000001";
      const sourceId2 = "1000000000000000002";
      const replyId2 = "2000000000000000002";

      await forumOracle.connect(oracle).recordResponse(replyId1, sourceId1, contentHash);
      await forumOracle.connect(oracle).recordResponse(replyId2, sourceId2, contentHash);

      expect(await forumOracle.hasResponse(sourceId1)).to.be.true;
      expect(await forumOracle.hasResponse(sourceId2)).to.be.true;
      expect(await forumOracle.getResponse(sourceId1)).to.equal(replyId1);
      expect(await forumOracle.getResponse(sourceId2)).to.equal(replyId2);
    });

    it("Should return false for source posts without responses", async function () {
      const { forumOracle, sourceId } = await loadFixture(deployForumOracleFixture);

      expect(await forumOracle.hasResponse(sourceId)).to.be.false;
      expect(await forumOracle.getResponse(sourceId)).to.equal("");
    });

    it("Should not allow zero hash for response", async function () {
      const { forumOracle, oracle, replyId, sourceId } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(oracle).recordResponse(replyId, sourceId, ethers.ZeroHash)
      ).to.be.revertedWith("Invalid hash");
    });
  });

  describe("Post Verification", function () {
    it("Should verify correct content", async function () {
      const { forumOracle, oracle, postId, content, contentHash } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(oracle).recordPost(postId, contentHash);

      expect(await forumOracle.verifyPost(postId, content)).to.be.true;
    });

    it("Should reject incorrect content", async function () {
      const { forumOracle, oracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(oracle).recordPost(postId, contentHash);

      expect(await forumOracle.verifyPost(postId, "Wrong content")).to.be.false;
    });

    it("Should return false for non-existent post", async function () {
      const { forumOracle, content } = await loadFixture(deployForumOracleFixture);

      expect(await forumOracle.verifyPost("nonexistent", content)).to.be.false;
    });
  });

  describe("Oracle Management", function () {
    it("Should allow owner to update oracle", async function () {
      const { forumOracle, owner, otherAccount, oracle } = await loadFixture(deployForumOracleFixture);

      await expect(forumOracle.connect(owner).updateOracle(otherAccount.address))
        .to.emit(forumOracle, "OracleUpdated")
        .withArgs(oracle.address, otherAccount.address);

      expect(await forumOracle.oracleAddress()).to.equal(otherAccount.address);
    });

    it("Should not allow non-owner to update oracle", async function () {
      const { forumOracle, otherAccount, notOracle } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(notOracle).updateOracle(otherAccount.address)
      ).to.be.revertedWithCustomError(forumOracle, "OwnableUnauthorizedAccount");
    });

    it("Should not allow zero address as oracle", async function () {
      const { forumOracle, owner } = await loadFixture(deployForumOracleFixture);

      await expect(
        forumOracle.connect(owner).updateOracle(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("Should transfer permissions to new oracle", async function () {
      const { forumOracle, owner, otherAccount, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      await forumOracle.connect(owner).updateOracle(otherAccount.address);

      // New oracle should be able to record
      await expect(forumOracle.connect(otherAccount).recordPost(postId, contentHash))
        .to.emit(forumOracle, "PostRecorded");
    });
  });

  describe("Finality Checks", function () {
    it("Should return correct confirmation count for a post", async function () {
      const { forumOracle, oracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      // Record post
      await forumOracle.connect(oracle).recordPost(postId, contentHash);

      // Should have at least 1 confirmation
      const confirmations = await forumOracle.getConfirmations(postId);
      expect(confirmations).to.be.greaterThanOrEqual(1);
    });

    it("Should return 0 confirmations for non-existent post", async function () {
      const { forumOracle } = await loadFixture(deployForumOracleFixture);

      const confirmations = await forumOracle.getConfirmations("nonexistent");
      expect(confirmations).to.equal(0);
    });

    it("Should correctly determine post finality after 10 blocks", async function () {
      const { forumOracle, oracle, postId, contentHash } = await loadFixture(deployForumOracleFixture);

      // Record post
      await forumOracle.connect(oracle).recordPost(postId, contentHash);

      // Initially not final (less than 10 confirmations)
      let isFinal = await forumOracle.isPostFinal(postId);
      expect(isFinal).to.be.false;

      // Mine 10 blocks
      for (let i = 0; i < 10; i++) {
        await hre.network.provider.send("evm_mine");
      }

      // Now should be final
      isFinal = await forumOracle.isPostFinal(postId);
      expect(isFinal).to.be.true;

      // Confirmations should be >= 11 (original block + 10 mined)
      const confirmations = await forumOracle.getConfirmations(postId);
      expect(confirmations).to.be.greaterThanOrEqual(11);
    });

    it("Should return false for finality of non-existent post", async function () {
      const { forumOracle } = await loadFixture(deployForumOracleFixture);

      const isFinal = await forumOracle.isPostFinal("nonexistent");
      expect(isFinal).to.be.false;
    });

    it("Should correctly determine response finality", async function () {
      const { forumOracle, oracle, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      // Record response
      await forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash);

      // Initially not final
      let isFinal = await forumOracle.isResponseFinal(sourceId);
      expect(isFinal).to.be.false;

      // Mine 10 blocks
      for (let i = 0; i < 10; i++) {
        await hre.network.provider.send("evm_mine");
      }

      // Now should be final
      isFinal = await forumOracle.isResponseFinal(sourceId);
      expect(isFinal).to.be.true;
    });

    it("Should return false for response finality when no response exists", async function () {
      const { forumOracle, sourceId } = await loadFixture(deployForumOracleFixture);

      const isFinal = await forumOracle.isResponseFinal(sourceId);
      expect(isFinal).to.be.false;
    });
  });

  describe("Complex Scenarios", function () {
    it("Should handle multiple posts and responses", async function () {
      const { forumOracle, oracle } = await loadFixture(deployForumOracleFixture);

      // Record multiple source posts
      const post1 = "1000000000000000001";
      const post2 = "1000000000000000002";
      const hash1 = ethers.sha256(ethers.toUtf8Bytes("Post 1"));
      const hash2 = ethers.sha256(ethers.toUtf8Bytes("Post 2"));

      await forumOracle.connect(oracle).recordPost(post1, hash1);
      await forumOracle.connect(oracle).recordPost(post2, hash2);

      // Record responses to each
      const reply1 = "2000000000000000001";
      const reply2 = "2000000000000000002";
      const replyHash1 = ethers.sha256(ethers.toUtf8Bytes("Reply 1"));
      const replyHash2 = ethers.sha256(ethers.toUtf8Bytes("Reply 2"));

      await forumOracle.connect(oracle).recordResponse(reply1, post1, replyHash1);
      await forumOracle.connect(oracle).recordResponse(reply2, post2, replyHash2);

      // Verify all posts exist
      expect((await forumOracle.getPostRecord(post1)).exists).to.be.true;
      expect((await forumOracle.getPostRecord(post2)).exists).to.be.true;
      expect((await forumOracle.getPostRecord(reply1)).exists).to.be.true;
      expect((await forumOracle.getPostRecord(reply2)).exists).to.be.true;

      // Verify response tracking
      expect(await forumOracle.hasResponse(post1)).to.be.true;
      expect(await forumOracle.hasResponse(post2)).to.be.true;
      expect(await forumOracle.getResponse(post1)).to.equal(reply1);
      expect(await forumOracle.getResponse(post2)).to.equal(reply2);
    });

    it("Should maintain state after oracle change", async function () {
      const { forumOracle, owner, oracle, otherAccount, postId, replyId, sourceId, contentHash } = await loadFixture(deployForumOracleFixture);

      // Record with original oracle
      await forumOracle.connect(oracle).recordResponse(replyId, sourceId, contentHash);

      // Change oracle
      await forumOracle.connect(owner).updateOracle(otherAccount.address);

      // State should still be accessible
      expect(await forumOracle.hasResponse(sourceId)).to.be.true;
      expect(await forumOracle.getResponse(sourceId)).to.equal(replyId);

      // Should still enforce one response per source
      const newReplyId = "9999999999999999999";
      const newHash = ethers.sha256(ethers.toUtf8Bytes("New reply"));
      await expect(
        forumOracle.connect(otherAccount).recordResponse(newReplyId, sourceId, newHash)
      ).to.be.revertedWith("Source post already has a response");
    });
  });
});
