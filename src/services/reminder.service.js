const { getRealtimeDb, getDb } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const { deleteFile } = require("../utils/uploads");
const { logger } = require("../utils/logger");

const rtdb = getRealtimeDb();
const db = getDb();

const STATUS_PENDING = "pending";
const STATUS_PROCESSING = "processing";
const STATUS_SENT = "sent";
const STATUS_CANCELLED = "cancelled";

const parseScheduledAt = (scheduledAt) => {
  if (
    typeof scheduledAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)
  ) {
    throw new Error("scheduledAt must be a valid ISO 8601 datetime string");
  }
  const timestamp = Date.parse(scheduledAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error("scheduledAt must be a valid ISO 8601 datetime string");
  }
  return timestamp;
};

const requireFutureTimestamp = (timestamp) => {
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error("Reminder time must be in the future.");
  }
};

const normalizeMentions = (mentions = []) =>
  Array.isArray(mentions) ? mentions.filter((id) => typeof id === "string") : [];

const findReminderById = async (reminderId) => {
  const directPath = `reminders/${reminderId}`;
  const directSnapshot = await rtdb.ref(directPath).once("value");
  if (directSnapshot.exists()) {
    return { key: reminderId, reminder: directSnapshot.val() };
  }

  const remindersSnapshot = await rtdb.ref("reminders").once("value");
  if (!remindersSnapshot.exists()) return null;

  let match = null;
  remindersSnapshot.forEach((child) => {
    if (!match && child.val()?.reminderId === reminderId) {
      match = { key: child.key, reminder: child.val() };
    }
  });
  return match;
};

const assertTargetIsAvailable = async ({ createdBy, targetType, targetId, receiverId }) => {
  if (targetType === "group") {
    const groupSnap = await rtdb.ref(`groups/${targetId}`).once("value");
    if (!groupSnap.exists()) throw new Error("Group not found");
    const group = groupSnap.val();
    if (!group.members?.[createdBy] || group.members[createdBy].status !== "accepted") {
      throw new Error("You are not a member of this group");
    }
    return;
  }

  if (targetType === "private_chat") {
    if (!receiverId) throw new Error("receiverId is required for private_chat");
    if (createdBy === receiverId) throw new Error("You cannot set a reminder for yourself");

    const roomId = [createdBy, receiverId].sort().join("_");
    const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
    if (!roomSnap.exists()) {
      throw new Error("Chat room not found. Please send a message first.");
    }
  }
};

const isDue = (reminder) => {
  if (!reminder.scheduledAt) return false;
  const isOverdue = reminder.scheduledAt <= Date.now();
  return isOverdue && reminder.status === STATUS_PENDING;
};

exports.createReminder = async ({
  createdBy,
  message,
  targetType,
  targetId,
  receiverId,
  scheduledAt,
  mentions = [],
  attachment = null,
}) => {
  const now = Date.now();
  const scheduledAtNum = parseScheduledAt(scheduledAt);
  requireFutureTimestamp(scheduledAtNum);
  await assertTargetIsAvailable({ createdBy, targetType, targetId, receiverId });

  const reminderId = uuidv4();
  const reminder = {
    reminderId,
    createdBy,
    message: message.trim(),
    mentions: normalizeMentions(mentions),
    targetType,
    targetId,
    receiverId: receiverId || "",
    scheduledAt: scheduledAtNum,
    attachment,
    status: STATUS_PENDING,
    createdAt: now,
    sentAt: null,
  };

  await rtdb.ref(`reminders/${reminderId}`).set(reminder);
  return reminder;
};

exports.updateReminder = async (reminderId, userId, changes) => {
  const record = await findReminderById(reminderId);
  if (!record) throw new Error("Reminder not found");

  const reminderRef = rtdb.ref(`reminders/${record.key}`);
  const existing = record.reminder;
  if (existing.createdBy !== userId) {
    throw new Error("Only the creator can edit this reminder");
  }

  const has = (field) => Object.prototype.hasOwnProperty.call(changes, field);
  const targetType = has("targetType") ? changes.targetType : existing.targetType;
  const targetId = has("targetId") ? changes.targetId : existing.targetId;
  const receiverId = has("receiverId")
    ? changes.receiverId
    : targetType === "group" && targetType !== existing.targetType
      ? ""
      : existing.receiverId;
  const scheduledAt = has("scheduledAt")
    ? parseScheduledAt(changes.scheduledAt)
    : existing.scheduledAt;
  requireFutureTimestamp(scheduledAt);
  await assertTargetIsAvailable({ createdBy: userId, targetType, targetId, receiverId });

  const update = {};
  update.reminderId = record.key;
  for (const field of ["message", "targetType", "targetId", "receiverId"]) {
    if (has(field)) update[field] = field === "message" ? changes[field].trim() : changes[field];
  }
  if (targetType !== existing.targetType && targetType === "group" && !has("receiverId")) {
    update.receiverId = "";
  }
  if (has("scheduledAt")) update.scheduledAt = scheduledAt;
  if (has("mentions")) update.mentions = normalizeMentions(changes.mentions);
  if (has("attachment")) update.attachment = changes.attachment;
  update.updatedAt = Date.now();

  let transactionError;
  const result = await reminderRef.transaction((current) => {
    if (!current) {
      transactionError = "Reminder not found";
      return;
    }
    if (current.createdBy !== userId) {
      transactionError = "Only the creator can edit this reminder";
      return;
    }
    if (current.status !== STATUS_PENDING) {
      transactionError = "Only pending reminders can be edited";
      return;
    }
    if (!Number.isFinite(current.scheduledAt) || current.scheduledAt <= Date.now()) {
      transactionError = "Reminder time must be in the future.";
      return;
    }
    return { ...current, ...update };
  });

  if (!result.committed) throw new Error(transactionError || "Reminder could not be updated");

  if (has("attachment") && existing.attachment?.storagePath) {
    try {
      await deleteFile(existing.attachment.storagePath);
    } catch (error) {
      logger.error("Failed to delete replaced reminder attachment:", error);
    }
  }

  return result.snapshot.val();
};

exports.getReminders = async (userId) => {
  const snapshot = await rtdb.ref("reminders").once("value");
  if (!snapshot.exists()) return [];

  const reminders = [];
  snapshot.forEach((child) => {
    const r = child.val();
    if (r.createdBy === userId) reminders.push({ ...r, reminderId: child.key });
  });

  reminders.sort((a, b) => (b.scheduledAt || 0) - (a.scheduledAt || 0));
  return reminders;
};

exports.getReminder = async (reminderId, userId) => {
  const record = await findReminderById(reminderId);
  if (!record) throw new Error("Reminder not found");

  const reminder = { ...record.reminder, reminderId: record.key };
  if (reminder.createdBy !== userId) {
    throw new Error("Only the creator can view this reminder");
  }
  return reminder;
};

exports.cancelReminder = async (reminderId, userId) => {
  const record = await findReminderById(reminderId);
  if (!record) throw new Error("Reminder not found");

  let transactionError;
  const result = await rtdb.ref(`reminders/${record.key}`).transaction((current) => {
    if (!current) {
      transactionError = "Reminder not found";
      return;
    }
    if (current.createdBy !== userId) {
      transactionError = "Only the creator can cancel this reminder";
      return;
    }
    if (current.status !== STATUS_PENDING) {
      transactionError = "Only pending reminders can be cancelled";
      return;
    }
    if (current.scheduledAt <= Date.now()) {
      transactionError = "Only future reminders can be cancelled";
      return;
    }
    return { ...current, status: STATUS_CANCELLED, cancelledAt: Date.now() };
  });
  if (!result.committed) throw new Error(transactionError || "Reminder could not be cancelled");
};

exports.getDueReminders = async () => {
  const snapshot = await rtdb.ref("reminders").once("value");
  if (!snapshot.exists()) return [];

  const due = [];
  snapshot.forEach((child) => {
    const r = child.val();
    if (isDue(r)) due.push(r);
  });
  return due;
};

exports.markReminderSent = async (reminderId) => {
  await rtdb.ref(`reminders/${reminderId}/status`).transaction((current) => {
    if (current === STATUS_PROCESSING) return STATUS_SENT;
    return current;
  });
  await rtdb.ref(`reminders/${reminderId}/sentAt`).set(Date.now());
};

exports.claimReminder = async (reminderId) => {
  const result = await rtdb.ref(`reminders/${reminderId}/status`).transaction((current) => {
    if (current === STATUS_PENDING) return STATUS_PROCESSING;
    return current;
  });
  return result.committed;
};

exports.recoverStuckReminders = async () => {
  const snapshot = await rtdb.ref("reminders").once("value");
  if (!snapshot.exists()) return 0;

  let recovered = 0;
  const updates = {};
  const now = Date.now();
  const stuckThreshold = 2 * 60 * 1000; // 2 minutes

  snapshot.forEach((child) => {
    const r = child.val();
    if (r.status === STATUS_PROCESSING && r.scheduledAt && now - r.scheduledAt > stuckThreshold) {
      updates[`${child.key}/status`] = STATUS_PENDING;
      updates[`${child.key}/sentAt`] = null;
      updates[`${child.key}/error`] = null;
      recovered++;
    }
  });

  if (recovered > 0) {
    await rtdb.ref().update(updates);
  }
  return recovered;
};

exports.markReminderFailed = async (reminderId, errorMessage) => {
  await rtdb.ref(`reminders/${reminderId}/status`).transaction((current) => {
    if (current === STATUS_PROCESSING) return "failed";
    return current;
  });
  await rtdb.ref(`reminders/${reminderId}/error`).set(errorMessage);
  await rtdb.ref(`reminders/${reminderId}/sentAt`).set(Date.now());
};
