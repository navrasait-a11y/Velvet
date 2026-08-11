const { body, param } = require("express-validator");

const blockUser = [
  body("userId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid userId"),
];

const unblockUser = [
  param("userId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid userId"),
];

module.exports = {
  blockUser,
  unblockUser,
};
