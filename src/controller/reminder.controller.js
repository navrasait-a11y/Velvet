const reminderService = require("../services/reminder.service");
const { logger } = require("../utils/logger");
const { uploadFile, deleteFile } = require("../utils/uploads");

const getReminderErrorStatus = (error) => {
  const message = error?.message || "";
  if (message === "Reminder not found") return 404;
  if (message.includes("Only the creator") || message.includes("not a member")) return 403;
  if (message.includes("not found") || message.includes("Chat room not found")) return 404;
  if (message.includes("Only pending") || message.includes("Only future")) return 409;
  if (
    message.includes("must be") ||
    message.includes("is required") ||
    message.includes("cannot set a reminder") ||
    message.includes("Invalid")
  ) return 400;
  return 500;
};

const getMentions = (value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error("mentions must be an array");
};

const cleanupUploadedFile = async (file) => {
  if (!file?.storagePath) return;
  try {
    await deleteFile(file.storagePath);
  } catch (error) {
    logger.error("Failed to clean up unused reminder attachment:", error);
  }
};

exports.createReminder = async (req, res) => {
  let attachment = null;
  try {
    const userId = req.user.userId;
    const { message, targetType, targetId, receiverId, scheduledAt, mentions } = req.body;
    const parsedMentions = getMentions(mentions);
    if (req.file) attachment = await uploadFile(req.file, "reminders");

    const reminder = await reminderService.createReminder({
      createdBy: userId,
      message,
      targetType,
      targetId,
      receiverId,
      scheduledAt,
      mentions: parsedMentions,
      attachment,
    });

    attachment = null;
    return res.status(201).json({ success: true, message: "Reminder scheduled", data: reminder });
  } catch (error) {
    await cleanupUploadedFile(attachment);
    logger.error("Create Reminder Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.updateReminder = async (req, res) => {
  let attachment = null;
  try {
    const reminderId = req.params.id || req.params.reminderId;
    const changes = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(changes, "mentions")) {
      changes.mentions = getMentions(changes.mentions);
    }
    if (req.file) {
      attachment = await uploadFile(req.file, "reminders");
      changes.attachment = attachment;
    }

    const reminder = await reminderService.updateReminder(reminderId, req.user.userId, changes);
    attachment = null;
    return res.status(200).json({ success: true, message: "Reminder updated", data: reminder });
  } catch (error) {
    await cleanupUploadedFile(attachment);
    logger.error("Update Reminder Error:", error);
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
    const reminderId = req.params.id || req.params.reminderId;

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
    const reminderId = req.params.id || req.params.reminderId;

    await reminderService.cancelReminder(reminderId, userId);
    return res.status(200).json({ success: true, message: "Reminder cancelled" });
  } catch (error) {
    logger.error("Cancel Reminder Error:", error);
    return res.status(getReminderErrorStatus(error)).json({ success: false, message: error.message });
  }
};
