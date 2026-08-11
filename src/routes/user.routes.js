const express = require("express");
const router = express.Router();

const profileController = require("../controller/user.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { uploadProfileFields, handleUploadError } = require("../middleware/upload");
const { sanitize } = require("../middleware/sanitize");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { createProfile, updateProfile, checkContact } = require("../validations/user.validation");

router.post(
  "/create",
  authMiddleware,
  uploadProfileFields,
  handleUploadError,
  sanitize,
  createProfile,
  handleValidationErrors,
  profileController.createProfile
);

router.patch(
  "/update",
  authMiddleware,
  uploadProfileFields,
  handleUploadError,
  sanitize,
  updateProfile,
  handleValidationErrors,
  profileController.updateProfile
);

router.get("/me", authMiddleware, profileController.getProfile);

router.get("/profile/:userId", authMiddleware, profileController.getUserProfile);

router.post("/check-contact", authMiddleware, checkContact, handleValidationErrors, profileController.checkcontact);

module.exports = router;
