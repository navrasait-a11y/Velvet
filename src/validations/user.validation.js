const { body } = require("express-validator");

const createProfile = [
  body("name")
    .isString()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be 2-50 characters"),
];

const updateProfile = [
  body("name")
    .optional()
    .isString()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be 2-50 characters"),
  body("bio")
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage("Bio max 200 characters"),
];

const checkContact = [
  body("contacts")
    .isArray({ max: 1000 })
    .withMessage("contacts must be an array (max 1000)"),
];

module.exports = {
  createProfile,
  updateProfile,
  checkContact,
};
