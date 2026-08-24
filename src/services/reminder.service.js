const { getRealtimeDb, getDb } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../utils/logger");

const rtdb = getRealtimeDb();
const db = getDb();

const STATUS_PENDING = "pending";
const STATUS_PROCESSING = "processing";
const STATUS_SENT = "sent";
const STATUS_CANCELLED = "cancelled";

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
}) => {
  const now = Date.now();
  const scheduledAtNum = typeof scheduledAt === "string" ? new Date(scheduledAt).getTime() : scheduledAt;

  if (isNaN(scheduledAtNum) || scheduledAtNum <= now) {
    throw new Error("scheduledAt must be a valid future timestamp");
  }

  if (targetType === "group") {
    const groupSnap = await rtdb.ref(`groups/${targetId}`).once("value");
    if (!groupSnap.exists()) throw new Error("Group not found");
    const group = groupSnap.val();
    if (!group.members?.[createdBy] || group.members[createdBy].status !== "accepted") {
      throw new Error("You are not a member of this group");
    }
  } else if (targetType === "private_chat") {
    if (!receiverId) throw new Error("receiverId is required for private_chat");
    if (createdBy === receiverId) throw new Error("You cannot set a reminder for yourself");

    const roomId = [createdBy, receiverId].sort().join("_");
    const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
    if (!roomSnap.exists()) {
      throw new Error("Chat room not found. Please send a message first.");
    }
  }

  const reminderId = uuidv4();
  const reminder = {
    reminderId,
    createdBy,
    message: message.trim(),
    mentions: Array.isArray(mentions) ? mentions.filter((id) => typeof id === "string") : [],
    targetType,
    targetId,
    receiverId: receiverId || "",
    scheduledAt: scheduledAtNum,
    status: STATUS_PENDING,
    createdAt: now,
    sentAt: null,
  };

  await rtdb.ref(`reminders/${reminderId}`).set(reminder);
  return reminder;
};

exports.getReminders = async (userId) => {
  const snapshot = await rtdb.ref("reminders").once("value");
  if (!snapshot.exists()) return [];

  const reminders = [];
  snapshot.forEach((child) => {
    const r = child.val();
    if (r.createdBy === userId && r.status !== STATUS_CANCELLED) {
      reminders.push(r);
    }
  });

  reminders.sort((a, b) => (b.scheduledAt || 0) - (a.scheduledAt || 0));
  return reminders;
};

exports.getReminder = async (reminderId, userId) => {
  const snap = await rtdb.ref(`reminders/${reminderId}`).once("value");
  if (!snap.exists()) throw new Error("Reminder not found");

  const reminder = snap.val();
  if (reminder.createdBy !== userId) {
    throw new Error("Only the creator can view this reminder");
  }
  return reminder;
};

exports.cancelReminder = async (reminderId, userId) => {
  const snap = await rtdb.ref(`reminders/${reminderId}`).once("value");
  if (!snap.exists()) throw new Error("Reminder not found");

  const reminder = snap.val();
  if (reminder.createdBy !== userId) {
    throw new Error("Only the creator can cancel this reminder");
  }
  if (reminder.status !== STATUS_PENDING) {
    throw new Error("Only pending reminders can be cancelled");
  }

  await rtdb.ref(`reminders/${reminderId}/status`).set(STATUS_CANCELLED);
  await rtdb.ref(`reminders/${reminderId}/cancelledAt`).set(Date.now());
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
