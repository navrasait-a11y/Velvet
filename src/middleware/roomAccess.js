const chatService = require("../services/chat.service");
const { logger } = require("../utils/logger");

const roomAccess = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // roomId can come from params, body or query
    const roomId = req.params.roomId || req.body.roomId || req.query.roomId;

    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: "roomId is required",
      });
    }

    const room = await chatService.getRoom(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (!room.participants?.[userId]) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant of this room",
      });
    }

    // Store room for later use
    req.room = room;

    next();
  } catch (error) {
    logger.error("Room Access Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = roomAccess;
