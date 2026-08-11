const { body, param, query } = require("express-validator");

const validateRoomId = param("roomId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid roomId");

const createRoom = [
  body("receiverId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid receiverId"),
];

const sendMessage = [
  body("receiverId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid receiverId"),
  body("type")
    .optional()
    .isIn(["text", "image", "video", "audio", "document", "location", "contact"])
    .withMessage("Invalid message type"),
  body("message")
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage("Message too long (max 5000 chars)"),
];

const getMessages = [
  validateRoomId,
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be 1-100"),
];

const deleteMessage = [
  body("roomId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid roomId"),
  body("messageId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid messageId"),
];

const markDelivered = [
  validateRoomId,
  body("messageIds")
    .isArray({ max: 500 })
    .withMessage("messageIds must be an array (max 500)"),
];

const markRead = [
  validateRoomId,
  body("messageIds")
    .isArray({ max: 500 })
    .withMessage("messageIds must be an array (max 500)"),
];

const updateTyping = [
  validateRoomId,
  body("isTyping")
    .isBoolean()
    .withMessage("isTyping must be a boolean"),
];

module.exports = {
  createRoom,
  sendMessage,
  getMessages,
  deleteMessage,
  markDelivered,
  markRead,
  updateTyping,
};
