const reminderService = require("../services/reminder.service");
const { logger } = require("../utils/logger");

const getReminderErrorStatus = (error) => {
  const message = error?.message || "";
  if (message === "Reminder not found") return 404;
  if (message.includes("Only the creator")) return 403;
  if (message.includes("must be a valid future")) return 400;
  if (message.includes("not found") || message.includes("not a member") || message.includes("Chat room not found")) return 404;
  return 500;
};

exports.createReminder = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { message, targetType, targetId, receiverId, scheduledAt, mentions } = req.body;

    const reminder = await reminderService.createReminder({
      createdBy: userId,
      message,
      targetType,
      targetId,
      receiverId,
      scheduledAt,
      mentions,
    });

    return res.status(201).json({ success: true, message: "Reminder scheduled", data: reminder });
  } catch (error) {
    logger.error("Create Reminder Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.getReminders = async (req, res) => {
  try {
    const userId = req.user.userId;
    const reminders = await reminderService.getReminders(userId);
    return res.status(200).json({ success: true, count: reminders.length, data: reminders });
  } catch (error) {
    logger.error("Get Reminders Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.getReminder = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reminderId } = req.params;

    const reminder = await reminderService.getReminder(reminderId, userId);
    return res.status(200).json({ success: true, data: reminder });
  } catch (error) {
    logger.error("Get Reminder Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.deleteReminder = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reminderId } = req.params;

    await reminderService.cancelReminder(reminderId, userId);
    return res.status(200).json({ success: true, message: "Reminder cancelled" });
  } catch (error) {
    logger.error("Cancel Reminder Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};
