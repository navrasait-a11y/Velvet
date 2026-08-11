const { body, param, query } = require("express-validator");

const validateGroupId = param("groupId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid groupId");

const parseJsonArrayField = (value) => {
  if (value === undefined || value === null || value === "") return value;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const createGroup = [
  body("groupName")
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage("Group name must be 1-100 chars"),
  body("groupBio")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("Bio max 500 chars"),
  body("members")
    .optional()
    .customSanitizer(parseJsonArrayField)
    .isArray({ max: 255 })
    .withMessage("Members must be a valid JSON array (max 255)"),
];

const getGroupDetails = [validateGroupId];

const acceptInvitation = [validateGroupId];

const rejectInvitation = [validateGroupId];

const sendGroupMessage = [
  validateGroupId,
  body("message")
    .isString()
    .isLength({ min: 1, max: 5000 })
    .withMessage("Message must be 1-5000 chars"),
];

const getGroupMessages = [
  validateGroupId,
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be 1-100"),
];

const deleteGroupMessage = [
  validateGroupId,
  body("messageId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid messageId"),
];

const updateGroupTyping = [
  validateGroupId,
  body("isTyping")
    .isBoolean()
    .withMessage("isTyping must be a boolean"),
];

const addMembers = [
  validateGroupId,
  body("members")
    .customSanitizer(parseJsonArrayField)
    .isArray({ max: 255 })
    .withMessage("members must be a valid JSON array (max 255)"),
];

const removeMember = [
  validateGroupId,
  param("userId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid userId"),
];

const updateShowPhoneNumbers = [
  validateGroupId,
  body("showPhoneNumbers")
    .isBoolean()
    .withMessage("showPhoneNumbers must be a boolean"),
];

const leaveGroup = [validateGroupId];

const deleteGroupForMe = [validateGroupId];

const transferAdmin = [
  validateGroupId,
  body("newAdminId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid newAdminId"),
];

module.exports = {
  createGroup,
  getGroupDetails,
  acceptInvitation,
  rejectInvitation,
  sendGroupMessage,
  getGroupMessages,
  deleteGroupMessage,
  updateGroupTyping,
  addMembers,
  removeMember,
  updateShowPhoneNumbers,
  leaveGroup,
  deleteGroupForMe,
  transferAdmin,
};
