const { body, param } = require("express-validator");

const validateGroupId = param("groupId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid groupId");

const validateTaskId = param("taskId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid taskId");

const createTask = [
  validateGroupId,
  body("title")
    .isString()
    .isLength({ min: 1, max: 200 })
    .withMessage("Title must be 1-200 chars"),
  body("description")
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage("Description max 2000 chars"),
  body("date")
    .optional()
    .isString()
    .withMessage("Date must be a string"),
  body("time")
    .optional()
    .isString()
    .withMessage("Time must be a string"),
  body("assignedTo")
    .optional()
    .isString()
    .withMessage("assignedTo must be a string"),
  body("persons")
    .optional()
    .isArray()
    .withMessage("persons must be an array"),
  body("url")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("URL max 500 chars"),
  body("attachmentName")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("Attachment name max 500 chars"),
];

const getTasks = [validateGroupId];

const deleteTask = [
  validateGroupId,
  validateTaskId,
];

module.exports = {
  createTask,
  getTasks,
  deleteTask,
};
