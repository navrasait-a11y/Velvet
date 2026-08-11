const express = require("express");
const router = express.Router();
const reportController = require("../controller/report.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { reportUser: reportUserValidation } = require("../validations/report.validation");

router.post("/user", authMiddleware, reportUserValidation, handleValidationErrors, reportController.reportUser);

module.exports = router;
