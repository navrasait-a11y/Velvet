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

const privateChatLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: process.env.NODE_ENV === "production" ? 10 : 100,
	keyGenerator: (req) => `private:${req.user?.userId || ipKeyGenerator(req)}`,
	message: { success: false, message: "Too many attempts. Please try again later." },
});

router.post("/setup", authMiddleware, auditLog("setup_private_chat"), setupPrivateChatValidation, handleValidationErrors, privateChatController.setupPrivateChat);
router.post("/verify", authMiddleware, privateChatLimiter, verifyPrivateChatValidation, handleValidationErrors, privateChatController.verifyPrivateChat);
router.put("/ChangePassword", authMiddleware, privateChatLimiter, auditLog("change_private_password"), changePrivatePasswordValidation, handleValidationErrors, privateChatController.changePrivateChatPassword);
router.put("/change-password", authMiddleware, privateChatLimiter, auditLog("change_private_password"), changePrivatePasswordValidation, handleValidationErrors, privateChatController.changePrivateChatPassword);
router.patch("/password", authMiddleware, privateChatLimiter, auditLog("change_private_password"), changePrivatePasswordValidation, handleValidationErrors, privateChatController.changePrivateChatPassword);
router.delete("/password", authMiddleware, auditLog("remove_private_password"), removePrivatePasswordValidation, handleValidationErrors, privateChatController.removePrivateChatPassword);
router.get("/status", authMiddleware, privateChatController.getPrivateChatStatus);

module.exports = router;
