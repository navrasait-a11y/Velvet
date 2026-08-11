const { body } = require("express-validator");

const reportUser = [
  body("userId")
    .isString()
    .isLength({ min: 5, max: 100 })
    .withMessage("Invalid userId"),
  body("reason")
    .isString()
    .isLength({ min: 3, max: 50 })
    .withMessage("Invalid reason"),
  body("description")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("Description max 500 chars"),
];

module.exports = {
  reportUser,
};
