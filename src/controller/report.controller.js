const { reportUser, REPORT_REASONS } = require("../services/report.service");
const { logger } = require("../utils/logger");

exports.reportUser = async (req, res) => {
  try {
    const reporterId = req.user.userId;
    const { userId, reason, description } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (reporterId === userId) {
      return res.status(400).json({ success: false, message: "You cannot report yourself" });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: `reason is required. Valid values: ${REPORT_REASONS.join(", ")}`,
      });
    }

    await reportUser(reporterId, userId, reason, description);

    return res.status(200).json({
      success: true,
      message: "Report submitted successfully. Our team will review it.",
    });
  } catch (error) {
    logger.error("Report User Error:", error);

    const status =
      error.message === "You have already reported this user" ? 409
      : error.message === "User not found" ? 404
      : error.message.startsWith("Invalid reason") ? 400
      : 500;

    return res.status(status).json({ success: false, message: error.message });
  }
};
