const { body, param } = require("express-validator");

const batchPresence = [
  body("userIds")
    .isArray({ max: 100 })
    .withMessage("userIds must be an array (max 100)"),
];

const getPresence = [
  param("userId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid userId"),
];

module.exports = {
  batchPresence,
  getPresence,
};
