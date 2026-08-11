const chatService = require("../services/chat.service");
const { uploadFile } = require("../utils/uploads");
const { generateRoomId } = require("../utils/roomId");
const { logger } = require("../utils/logger");

const VALID_MESSAGE_TYPES = ["text", "image", "video", "audio", "document", "location", "contact"];

const getChatErrorStatus = (error) => {
  const message = error?.message || "";
  if (message === "Room not found" || message.includes("Chat room not found")) return 404;
  if (
    message === "Unauthorized" ||
    message.includes("mutual contact") ||
    message.includes("block exists") ||
    message.includes("Cannot send message") ||
    message.includes("Only the sender")
  ) return 403;
  if (message.includes("yourself")) return 400;
  return 500;
};

exports.createRoom = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId } = req.body;

    if (senderId === receiverId) {
      return res.status(400).json({ success: false, message: "You cannot create a chat with yourself" });
    }

    const roomId = generateRoomId(senderId, receiverId);
    const room = await chatService.createRoom(roomId, senderId, receiverId);

    return res.status(200).json({ success: true, message: "Room created successfully", data: room });
  } catch (error) {
    logger.error("Create Room Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, message, type = "text" } = req.body;

    if (senderId === receiverId) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid message type. Allowed: ${VALID_MESSAGE_TYPES.join(", ")}` });
    }

    let location = null;
    let contact = null;

    if (type === "text") {
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: "message is required for text type" });
      }
    } else if (["image", "video", "audio", "document"].includes(type)) {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "File is required for media messages" });
      }
    } else if (type === "location") {
      const { latitude, longitude, address, maplink } = req.body;
      if (!latitude || !longitude) {
        return res.status(400).json({ success: false, message: "latitude and longitude are required" });
      }
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, message: "Invalid coordinates" });
      }
      location = { latitude: lat, longitude: lng, address: address || "", maplink: maplink || "" };
    } else if (type === "contact") {
      if (!req.body.contact) {
        return res.status(400).json({ success: false, message: "contact data is required" });
      }
      try {
        contact = typeof req.body.contact === "string"
          ? JSON.parse(req.body.contact)
          : req.body.contact;
        if (typeof contact !== "object" || !contact) throw new Error();
      } catch {
        return res.status(400).json({ success: false, message: "Invalid contact format" });
      }
    }

    const roomId = generateRoomId(senderId, receiverId);

    await chatService.createRoom(roomId, senderId, receiverId);

    let media = null;
    if (req.file) {
      media = await uploadFile(req.file, "chat");
    }

    const data = await chatService.sendMessage({
      roomId, senderId, receiverId,
      message: message || "",
      type, media, location, contact,
    });

    return res.status(201).json({ success: true, message: "Message sent successfully", data });
  } catch (error) {
    logger.error("Send Message Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { lastKey } = req.query;

    const messages = await chatService.getMessages(roomId, userId, limit, lastKey);

    return res.status(200).json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    logger.error("Get Messages Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.getChatList = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { favorite, archived } = req.query;
    const isPrivate = req.query["private"];

    const chats = await chatService.getChatList(userId, favorite, archived, isPrivate);

    return res.status(200).json({ success: true, count: chats.length, data: chats });
  } catch (error) {
    logger.error("Get Chat List Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteForMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId, messageId } = req.body;

    if (!roomId || !messageId) {
      return res.status(400).json({ success: false, message: "roomId and messageId are required" });
    }

    await chatService.deleteForMe({ roomId, messageId, userId });

    return res.status(200).json({ success: true, message: "Message deleted for you successfully" });
  } catch (error) {
    logger.error("Delete For Me Error:", error);
    const status = error.message === "Message not found" ? 404 : getChatErrorStatus(error);
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.deleteForEveryone = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId, messageId } = req.body;

    if (!roomId || !messageId) {
      return res.status(400).json({ success: false, message: "roomId and messageId are required" });
    }

    await chatService.deleteForEveryone({ roomId, messageId, userId });

    return res.status(200).json({ success: true, message: "Message deleted for everyone successfully" });
  } catch (error) {
    logger.error("Delete For Everyone Error:", error);
    const status = error.message === "Message not found" ? 404 : getChatErrorStatus(error);
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.markDelivered = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { messageIds } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ success: false, message: "messageIds array is required" });
    }

    if (messageIds.length > 500) {
      return res.status(400).json({ success: false, message: "Maximum 500 messageIds per request" });
    }

    await chatService.markDelivered(roomId, messageIds, userId);

    return res.status(200).json({ success: true, message: "Messages marked as delivered" });
  } catch (error) {
    logger.error("Mark Delivered Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { messageIds } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ success: false, message: "messageIds array is required" });
    }

    if (messageIds.length > 500) {
      return res.status(400).json({ success: false, message: "Maximum 500 messageIds per request" });
    }

    const result = await chatService.markRead(roomId, messageIds, userId);

    return res.status(200).json({ success: true, message: "Messages marked as read", updatedCount: result.updated });
  } catch (error) {
    logger.error("Mark Read Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.updateTyping = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;
    const { isTyping } = req.body;

    if (typeof isTyping !== "boolean") {
      return res.status(400).json({ success: false, message: "isTyping must be a boolean" });
    }

    await chatService.updateTyping(roomId, userId, isTyping);

    return res.status(200).json({ success: true, message: "Typing status updated" });
  } catch (error) {
    logger.error("Typing Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Export Chat
// ─────────────────────────────────────────────────────────────────────────────
exports.exportChat = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomId } = req.params;

    const messages = await chatService.exportChat(roomId, userId);

    return res.status(200).json({
      success: true,
      data: {
        roomId,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        messages,
      },
    });
  } catch (error) {
    logger.error("Export Chat Error:", error);
    return res.status(getChatErrorStatus(error)).json({ success: false, message: error.message });
  }
};
