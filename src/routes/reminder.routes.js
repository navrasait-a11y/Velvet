const express = require("express");
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const reminderController = require("../controller/reminder.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { sanitize } = require("../middleware/sanitize");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { uploadReminderFile, handleUploadError } = require("../middleware/upload");
const {
  createReminder: createReminderValidation,
  updateReminder: updateReminderValidation,
  getReminders: getRemindersValidation,
  getReminder: getReminderValidation,
  deleteReminder: deleteReminderValidation,
} = require("../validations/reminder.validation");

const reminderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 20 : 100,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req),
  message: { success: false, message: "Too many reminder requests. Please slow down." },
});

router.post(
  "/",
  authMiddleware,
  reminderLimiter,
  uploadReminderFile,
  handleUploadError,
  sanitize,
  createReminderValidation,
  handleValidationErrors,
  reminderController.createReminder
);
router.get("/", authMiddleware, getRemindersValidation, handleValidationErrors, reminderController.getReminders);
router.get("/:id", authMiddleware, getReminderValidation, handleValidationErrors, reminderController.getReminder);
router.put(
  "/:id",
  authMiddleware,
  reminderLimiter,
  uploadReminderFile,
  handleUploadError,
  sanitize,
  updateReminderValidation,
  handleValidationErrors,
  reminderController.updateReminder
);
router.delete("/:id", authMiddleware, deleteReminderValidation, handleValidationErrors, reminderController.deleteReminder);

module.exports = router;
