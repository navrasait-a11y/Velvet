const { validationResult } = require("express-validator");
const { logger } = require("../utils/logger");

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg).join(", ");
    logger.warn(`Validation failed: ${messages} (requestId: ${req.id || "unknown"})`);
    return res.status(400).json({ success: false, message: messages });
  }
  next();
};

module.exports = { handleValidationErrors };
