const express = require("express");
const router = express.Router();
const chatOptionController = require("../controller/chatOption.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { auditLog } = require("../middleware/auditLog");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { validateRoomId } = require("../validations/chatOption.validation");
const { body } = require("express-validator");

const booleanOption = (fieldName) =>
  body(fieldName)
    .isBoolean({ strict: false })
    .toBoolean()
    .withMessage(`${fieldName} must be a boolean`);

// PATCH /api/options/favorite/:roomId
router.patch(
  "/favorite/:roomId",
  authMiddleware,
  validateRoomId,
  booleanOption("isFavorite"),
  handleValidationErrors,
  auditLog("update_favorite"),
  chatOptionController.updateFavorite
);

// PATCH /api/options/archive/:roomId
router.patch(
  "/archive/:roomId",
  authMiddleware,
  validateRoomId,
  booleanOption("isArchived"),
  handleValidationErrors,
  auditLog("update_archived"),
  chatOptionController.updateArchived
);

// PATCH /api/options/pin/:roomId
router.patch(
  "/pin/:roomId",
  authMiddleware,
  validateRoomId,
  booleanOption("isPinned"),
  handleValidationErrors,
  chatOptionController.updatePinned
);

// PATCH /api/options/private/:roomId
// Requires private chat password to be set up before enabling
router.patch(
  "/private/:roomId",
  authMiddleware,
  validateRoomId,
  booleanOption("isPrivate"),
  handleValidationErrors,
  auditLog("update_private"),
  chatOptionController.updatePrivate
);

module.exports = router;
