const express = require("express");
const router = express.Router();
const { sendOtpHandler, verifyUserOtp, logout } = require("../controller/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { sendOtp, verifyOtp } = require("../validations/auth.validation");

router.post("/send-otp", sendOtp, handleValidationErrors, sendOtpHandler);
router.post("/verify-otp", verifyOtp, handleValidationErrors, verifyUserOtp);
router.post("/logout", authMiddleware, logout);

module.exports = router;
