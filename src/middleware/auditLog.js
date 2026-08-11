const { logger } = require("../utils/logger");

const auditLog = (action) => (req, res, next) => {
  const originalSend = res.send;
  const userId = req.user?.userId || "anonymous";
  const requestId = req.id || "unknown";

  res.send = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data?.success) {
        logger.info(`[AUDIT] user=${userId} action=${action} status=success requestId=${requestId}`);
      }
    } else if (res.statusCode >= 400) {
      logger.warn(`[AUDIT] user=${userId} action=${action} status=failed statusCode=${res.statusCode} requestId=${requestId}`);
    }

    res.send = originalSend;
    return res.send(body);
  };

  next();
};

module.exports = { auditLog };
