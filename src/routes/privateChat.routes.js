const express = require("express");
const router = express.Router();
const privateChatController = require("../controller/privateChat.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { auditLog } = require("../middleware/auditLog");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const {
  setupPrivateChat: setupPrivateChatValidation,
  verifyPrivateChat: verifyPrivateChatValidation,
  changePrivatePassword: changePrivatePasswordValidation,
  removePrivatePassword: removePrivatePasswordValidation,
} = require("../validations/privateChat.validation");

// Stricter rate limiter for password operations to prevent brute-force
const privateChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 10 : 100,
  keyGenerator: (req) => `private:${req.user?.userId || ipKeyGenerator(req)}`,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

// GET /api/privateChat/status — check if private chat is enabled
router.get("/status", authMiddleware, privateChatController.getPrivateChatStatus);

// POST /api/privateChat/setup — create private chat password
router.post(
  "/setup",
  authMiddleware,
  auditLog("setup_private_chat"),
  setupPrivateChatValidation,
  handleValidationErrors,
  privateChatController.setupPrivateChat
);

// POST /api/privateChat/verify — verify password to enter private section
router.post(
  "/verify",
  authMiddleware,
  privateChatLimiter,
  verifyPrivateChatValidation,
  handleValidationErrors,
  privateChatController.verifyPrivateChat
);

// PATCH /api/privateChat/password — change private chat password
router.patch(
  "/password",
  authMiddleware,
  privateChatLimiter,
  auditLog("change_private_password"),
  changePrivatePasswordValidation,
  handleValidationErrors,
  privateChatController.changePrivateChatPassword
);

// DELETE /api/privateChat/password — remove/disable private chat
router.delete(
  "/password",
  authMiddleware,
  privateChatLimiter,
  auditLog("remove_private_password"),
  removePrivatePasswordValidation,
  handleValidationErrors,
  privateChatController.removePrivateChatPassword
);

module.exports = router;
