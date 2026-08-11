const { body } = require("express-validator");

const setupPrivateChat = [
  body("password")
    .isString()
    .isLength({ min: 8, max: 64 })
    .withMessage("Password must be 8-64 characters"),
];

const verifyPrivateChat = [
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

const changePrivatePassword = [
  body("oldPassword")
    .notEmpty()
    .withMessage("oldPassword is required"),
  body("newPassword")
    .isString()
    .isLength({ min: 8, max: 64 })
    .withMessage("New password must be 8-64 characters"),
];

const removePrivatePassword = [
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

module.exports = {
  setupPrivateChat,
  verifyPrivateChat,
  changePrivatePassword,
  removePrivatePassword,
};
