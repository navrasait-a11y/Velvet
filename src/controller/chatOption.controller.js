const chatOptionService = require("../services/chatOption.service");
const { logger } = require("../utils/logger");

exports.updateFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { isFavorite } = req.body;

    await chatOptionService.updateFavorite(userId, roomId, isFavorite);
    return res.status(200).json({ success: true, message: "Favorite status updated successfully" });
  } catch (error) {
    logger.error("Update Favorite Error:", error);
    const status = error.message === "Chat not found" ? 404 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.updateArchived = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { isArchived } = req.body;

    await chatOptionService.updateArchived(userId, roomId, isArchived);
    return res.status(200).json({ success: true, message: "Archive status updated successfully" });
  } catch (error) {
    logger.error("Update Archive Error:", error);
    const status = error.message === "Chat not found" ? 404 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.updatePinned = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { isPinned } = req.body;

    await chatOptionService.updatePinned(userId, roomId, isPinned);
    return res.status(200).json({ success: true, message: "Pinned status updated successfully" });
  } catch (error) {
    logger.error("Update Pinned Error:", error);
    const status = error.message === "Chat not found" ? 404 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.updatePrivate = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { isPrivate } = req.body;

    await chatOptionService.updatePrivate(userId, roomId, isPrivate);
    return res.status(200).json({ success: true, message: "Private status updated successfully" });
  } catch (error) {
    logger.error("Update Private Error:", error);
    const status =
      error.message === "Chat not found" ? 404
        : error.message === "Set up a private chat password first" ? 400
        : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};
