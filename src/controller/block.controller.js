const blockService = require("../services/block.service");
const { logger } = require("../utils/logger");

exports.blockUser = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (blockerId === userId) {
      return res.status(400).json({ success: false, message: "You cannot block yourself" });
    }

    await blockService.blockUser(blockerId, userId);

    return res.status(200).json({ success: true, message: "User blocked successfully" });
  } catch (error) {
    logger.error("Block User Error:", error);
    const status = error.message === "User already blocked" ? 409
      : error.message === "User not found" ? 404
      : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (blockerId === userId) {
      return res.status(400).json({ success: false, message: "You cannot unblock yourself" });
    }

    await blockService.unblockUser(blockerId, userId);

    return res.status(200).json({ success: true, message: "User unblocked successfully" });
  } catch (error) {
    logger.error("Unblock User Error:", error);
    const status = error.message === "User is not blocked" ? 404 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.getBlockedUsers = async (req, res) => {
  try {
    const blockerId = req.user.userId;

    const blockedUsers = await blockService.getBlockedUsers(blockerId);

    return res.status(200).json({
      success: true,
      count: blockedUsers.length,
      data: blockedUsers,
    });
  } catch (error) {
    logger.error("Get Blocked Users Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
