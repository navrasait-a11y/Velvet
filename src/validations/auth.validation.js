const { body } = require("express-validator");

const sendOtp = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .isMobilePhone("any")
    .withMessage("Valid phone number is required"),
];

const verifyOtp = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .isMobilePhone("any")
    .withMessage("Valid phone number is required"),
  body("sessionId")
    .trim()
    .notEmpty()
    .withMessage("sessionId is required"),
  body("otp")
    .trim()
    .notEmpty()
    .withMessage("OTP is required")
    .matches(/^\d{4}$/)
    .withMessage("OTP must be 4 digits"),
];

module.exports = {
  sendOtp,
  verifyOtp,
};
