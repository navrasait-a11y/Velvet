const presenceService = require("../services/presence.service");
const { isBlocked } = require("../services/block.service");
const { logger } = require("../utils/logger");

/**
 * POST /presence/offline
 * Called by client on explicit logout.
 * For app-kill / network-drop, Firebase client SDK onDisconnect() handles it automatically.
 */
exports.setOffline = async (req, res) => {
  try {
    const userId = req.user.userId;
    await presenceService.setOffline(userId);
    return res.status(200).json({ success: true, message: "Status set to offline" });
  } catch (error) {
    logger.error("Set Offline Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update status" });
  }
};

/**
 * GET /presence/:userId
 * Get online status of a user.
 * Returns 403 if a block exists between the two users.
 */
exports.getPresence = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { userId } = req.params;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (requesterId === userId) {
      // Can always see your own status
      const presence = await presenceService.getPresence(userId);
      return res.status(200).json({
        success: true,
        data: { userId, online: presence.online || false, lastSeen: presence.lastSeen || null },
      });
    }

    // Privacy: blocked users cannot see each other's presence
    const blocked = await isBlocked(requesterId, userId);
    if (blocked) {
      return res.status(403).json({ success: false, message: "Cannot access this user's status" });
    }

    const presence = await presenceService.getPresence(userId);
    return res.status(200).json({
      success: true,
      data: { userId, online: presence.online || false, lastSeen: presence.lastSeen || null },
    });
  } catch (error) {
    logger.error("Get Presence Error:", error);
    return res.status(500).json({ success: false, message: "Failed to get status" });
  }
};

/**
 * POST /presence/batch
 * Get online status for multiple users.
 * Silently skips users where a block exists.
 * Max 100 users per call.
 */
exports.getBatchPresence = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: "userIds array is required" });
    }

    if (userIds.length > 100) {
      return res.status(400).json({ success: false, message: "Maximum 100 userIds per request" });
    }

    // Filter out blocked users in parallel
    const allowed = await Promise.all(
      userIds.map(async (uid) => {
        if (uid === requesterId) return uid;
        const blocked = await isBlocked(requesterId, uid);
        return blocked ? null : uid;
      })
    );

    const allowedIds = allowed.filter(Boolean);
    const presenceMap = await presenceService.getMultiplePresence(allowedIds);

    return res.status(200).json({ success: true, data: presenceMap });
  } catch (error) {
    logger.error("Batch Presence Error:", error);
    return res.status(500).json({ success: false, message: "Failed to get statuses" });
  }
};
