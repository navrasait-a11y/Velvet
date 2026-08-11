const express = require("express");
const router = express.Router();
const blockController = require("../controller/block.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { auditLog } = require("../middleware/auditLog");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { blockUser: blockUserValidation, unblockUser: unblockUserValidation } = require("../validations/block.validation");

router.post("/make", authMiddleware, auditLog("block_user"), blockUserValidation, handleValidationErrors, blockController.blockUser);
router.delete("/revert/:userId", authMiddleware, auditLog("unblock_user"), unblockUserValidation, handleValidationErrors, blockController.unblockUser);
router.get("/list", authMiddleware, blockController.getBlockedUsers);

module.exports = router;
