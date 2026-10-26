const { body, param, query } = require("express-validator");
const { isEmojiOnlyAbout } = require("../utils/aboutStatus");

const validateReminderId = param("id")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid reminderId");

const validateScheduledAt = (field, required = false) => {
  let validator = body(field);
  if (!required) validator = validator.optional();
  return validator
    .isString()
    .withMessage("scheduledAt must be a valid ISO 8601 datetime string")
    .bail()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage("scheduledAt must be a valid ISO 8601 datetime string")
    .bail()
    .custom((value) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    .withMessage("scheduledAt must include an ISO 8601 timezone");
};

const validateMentions = () =>
  body("mentions")
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      if (typeof value !== "string") return false;
      try {
        return Array.isArray(JSON.parse(value));
      } catch {
        return false;
      }
    })
    .withMessage("mentions must be an array");

const validateRangeDate = (field) =>
  query(field)
    .optional()
    .isString()
    .isISO8601({ strict: true, strictSeparator: true })
    .bail()
    .custom((value) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    .withMessage(`${field} must be a timezone-qualified ISO 8601 datetime`);

const createReminder = [
  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Title must be at most 200 characters"),
  body("message")
    .isString()
    .trim()
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
  body("receiverId")
    .custom((value, { req }) =>
      req.body.targetType !== "private_chat" ||
      (typeof value === "string" && value.length >= 5 && value.length <= 100)
    )
    .withMessage("receiverId is required for private_chat"),
  validateScheduledAt("scheduledAt", true),
  body("emoji")
    .optional()
    .isString()
    .isLength({ max: 32 })
    .bail()
    .custom((value) => value === "" || isEmojiOnlyAbout(value))
    .withMessage("emoji must be a string of at most 32 characters"),
  body("type")
    .optional()
    .isString()
    .isLength({ min: 1, max: 40 })
    .withMessage("type must be 1-40 characters"),
  validateMentions(),
];

const updateReminder = [
  validateReminderId,
  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Title must be at most 200 characters"),
  body("message")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage("Message must be 1-2000 chars"),
  body("targetType")
    .optional()
    .isString()
    .isIn(["private_chat", "group"])
    .withMessage("targetType must be private_chat or group"),
  body("targetId")
    .optional()
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid targetId"),
  body("receiverId")
    .optional()
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid receiverId"),
  validateScheduledAt("scheduledAt"),
  body("emoji")
    .optional()
    .isString()
    .isLength({ max: 32 })
    .bail()
    .custom((value) => value === "" || isEmojiOnlyAbout(value))
    .withMessage("emoji must be a string of at most 32 characters"),
  body("type")
    .optional()
    .isString()
    .isLength({ min: 1, max: 40 })
    .withMessage("type must be 1-40 characters"),
  validateMentions(),
];

const getReminders = [validateRangeDate("startAt"), validateRangeDate("endAt")];

const getReminder = [validateReminderId];

const deleteReminder = [validateReminderId];

module.exports = {
  createReminder,
  updateReminder,
  getReminders,
  getReminder,
  deleteReminder,
};
