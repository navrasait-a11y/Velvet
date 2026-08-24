const { body, param } = require("express-validator");

const validateReminderId = param("reminderId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid reminderId");

const createReminder = [
  body("message")
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage("Message must be 1-2000 chars"),
  body("targetType")
    .isString()
    .isIn(["private_chat", "group"])
    .withMessage("targetType must be private_chat or group"),
  body("targetId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid targetId"),
  body("receiverId")
    .optional()
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid receiverId"),
  body("scheduledAt")
    .isString()
    .notEmpty()
    .withMessage("scheduledAt is required")
    .isISO8601()
    .withMessage("scheduledAt must be a valid ISO 8601 datetime string"),
  body("mentions")
    .optional()
    .isArray()
    .withMessage("mentions must be an array"),
];

const getReminders = [];

const getReminder = [validateReminderId];

const deleteReminder = [validateReminderId];

module.exports = {
  createReminder,
  getReminders,
  getReminder,
  deleteReminder,
};
