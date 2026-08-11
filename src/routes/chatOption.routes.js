const express = require("express");
const router = express.Router();
const chatOptionController = require("../controller/chatOption.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { validateRoomId } = require("../validations/chatOption.validation");
const { body } = require("express-validator");

const booleanOption = (fieldName) =>
  body(fieldName)
    .isBoolean()
    .withMessage(`${fieldName} must be a boolean`);

router.patch("/favorite/:roomId", authMiddleware, validateRoomId, booleanOption("isFavorite"), handleValidationErrors, chatOptionController.updateFavorite);
router.patch("/archive/:roomId", authMiddleware, validateRoomId, booleanOption("isArchived"), handleValidationErrors, chatOptionController.updateArchived);
router.patch("/pin/:roomId", authMiddleware, validateRoomId, booleanOption("isPinned"), handleValidationErrors, chatOptionController.updatePinned);
router.patch("/private/:roomId", authMiddleware, validateRoomId, booleanOption("isPrivate"), handleValidationErrors, chatOptionController.updatePrivate);

module.exports = router;
