const { getRealtimeDb, getDb } = require("../config/firebase");
const groupService = require("../services/group.service");
const chatService = require("../services/chat.service");
const reminderService = require("../services/reminder.service");
const { getFcmToken, sendToToken } = require("../services/notification.service");
const { logger } = require("../utils/logger");

const rtdb = getRealtimeDb();
const db = getDb();

const SCHEDULER_INTERVAL_MS = 30_000;

const getSenderName = async (userId) => {
  try {
    const doc = await db.collection("Users_Profile").doc(userId).get();
    return doc.exists ? doc.data().name || "Velvet User" : "Velvet User";
  } catch {
    return "Velvet User";
  }
};

const notifyMentionedUsers = async (mentionedUserIds, senderName, message, roomId, groupId) => {
  if (!mentionedUserIds || mentionedUserIds.length === 0) return;

  await Promise.allSettled(
    mentionedUserIds.map(async (uid) => {
      try {
        const token = await getFcmToken(uid);
        if (!token) return;

        const title = `Reminder from ${senderName}`;
        const body = message.length > 100 ? message.slice(0, 97) + "..." : message;

        await sendToToken(
          token,
          { title, body },
          {
            type: "reminder",
            ...(roomId ? { roomId } : {}),
            ...(groupId ? { groupId } : {}),
          }
        );
      } catch (err) {
        logger.error(`[ReminderScheduler] Failed to notify mentioned user ${uid}:`, err.message);
      }
    })
  );
};

const deliverReminder = async (reminder) => {
  const { createdBy, message, targetType, targetId, receiverId, mentions = [] } = reminder;
  const senderName = await getSenderName(createdBy);

  if (targetType === "group") {
    const groupSnap = await rtdb.ref(`groups/${targetId}`).once("value");
    if (!groupSnap.exists()) throw new Error("Group not found when delivering reminder");
    const group = groupSnap.val();
    const member = group.members?.[createdBy];
    if (!member || member.status !== "accepted") {
      throw new Error("Sender is no longer a group member");
    }

    await groupService.sendGroupMessage({
      groupId: targetId,
      senderId: createdBy,
      message,
      type: "text",
    });

    const allMentionIds = mentions.filter((id) => id !== createdBy);
    if (allMentionIds.length > 0) {
      await notifyMentionedUsers(allMentionIds, senderName, message, null, targetId);
    }
  } else if (targetType === "private_chat") {
    const actualReceiverId = receiverId;
    if (!actualReceiverId) throw new Error("Missing receiverId for private chat reminder");

    const roomId = [createdBy, actualReceiverId].sort().join("_");
    const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
    if (!roomSnap.exists()) throw new Error("Chat room not found when delivering reminder");

    await chatService.sendMessage({
      roomId,
      senderId: createdBy,
      receiverId: actualReceiverId,
      message,
      type: "text",
    });

    const notifyIds = [actualReceiverId, ...mentions].filter((id) => id !== createdBy);
    const uniqueNotifyIds = [...new Set(notifyIds)];
    await notifyMentionedUsers(uniqueNotifyIds, senderName, message, roomId, null);
  }
};

const processDueReminders = async () => {
  try {
    await reminderService.recoverStuckReminders();

    const dueReminders = await reminderService.getDueReminders();
    if (dueReminders.length === 0) return;

    logger.info(`[ReminderScheduler] Processing ${dueReminders.length} due reminders`);

    for (const reminder of dueReminders) {
      try {
        const claimed = await reminderService.claimReminder(reminder.reminderId);
        if (!claimed) {
          logger.warn(`[ReminderScheduler] Skipping already-claimed reminder ${reminder.reminderId}`);
          continue;
        }

        await deliverReminder(reminder);
        await reminderService.markReminderSent(reminder.reminderId);
        logger.info(`[ReminderScheduler] Sent reminder ${reminder.reminderId}`);
      } catch (err) {
        logger.error(`[ReminderScheduler] Failed to send reminder ${reminder.reminderId}:`, err.message);
        await reminderService.markReminderFailed(reminder.reminderId, err.message);
      }
    }
  } catch (err) {
    logger.error("[ReminderScheduler] Error processing due reminders:", err.message);
  }
};

const startReminderScheduler = () => {
  processDueReminders();
  setInterval(processDueReminders, SCHEDULER_INTERVAL_MS);
  logger.info(`[ReminderScheduler] Started. Polling interval: ${SCHEDULER_INTERVAL_MS}ms`);
};

module.exports = { startReminderScheduler };
