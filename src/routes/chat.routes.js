const express = require("express");
const router = express.Router();

const chatController = require("../controller/chat.controller");
const authMiddleware = require("../middleware/auth.middleware");
const roomAccess = require("../middleware/roomAccess");
const { uploadSingleFile, handleUploadError } = require("../middleware/upload");
const { sanitize } = require("../middleware/sanitize");
const linkFilter = require("../middleware/linkFilter");
const { auditLog } = require("../middleware/auditLog");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const {
  createRoom: createRoomValidation,
  sendMessage: sendMessageValidation,
  getMessages: getMessagesValidation,
  deleteMessage: deleteMessageValidation,
  markDelivered,
  markRead,
  updateTyping,
} = require("../validations/chat.validation");

router.post("/room", authMiddleware, createRoomValidation, handleValidationErrors, chatController.createRoom);

router.post(
  "/send",
  authMiddleware,
  uploadSingleFile,
  handleUploadError,
  sanitize,
  sendMessageValidation,
  handleValidationErrors,
  linkFilter,
  chatController.sendMessage
);

router.get("/messages/:roomId", authMiddleware, roomAccess, getMessagesValidation, handleValidationErrors, chatController.getMessages);
router.get("/list", authMiddleware, chatController.getChatList);

router.put("/delete/me", authMiddleware, auditLog("delete_message_me"), deleteMessageValidation, handleValidationErrors, chatController.deleteForMe);
router.put("/delete/everyone", authMiddleware, auditLog("delete_message_everyone"), deleteMessageValidation, handleValidationErrors, chatController.deleteForEveryone);

router.put("/messages/:roomId/delivered", authMiddleware, markDelivered, handleValidationErrors, chatController.markDelivered);
router.put("/messages/:roomId/read", authMiddleware, markRead, handleValidationErrors, auditLog("mark_read"), chatController.markRead);
router.put("/messages/:roomId/typing", authMiddleware, updateTyping, handleValidationErrors, chatController.updateTyping);
router.get("/export/:roomId", authMiddleware, chatController.exportChat);

module.exports = router;
