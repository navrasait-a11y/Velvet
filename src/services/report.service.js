const { getDb, getTimestamp } = require("../config/firebase");

const db = getDb();

const REPORT_REASONS = [
  "spam",
  "harassment",
  "inappropriate_content",
  "fake_account",
  "other",
];

/**
 * Report a user. One user can report another only once.
 * Reports are stored in Firestore for manual admin review.
 */
const reportUser = async (reporterId, reportedUserId, reason, description = "") => {
  if (!REPORT_REASONS.includes(reason)) {
    throw new Error(`Invalid reason. Must be one of: ${REPORT_REASONS.join(", ")}`);
  }

  // Check if already reported
  const existingSnap = await db
    .collection("Reports")
    .where("reporterId", "==", reporterId)
    .where("reportedUserId", "==", reportedUserId)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    throw new Error("You have already reported this user");
  }

  // Verify reported user exists
  const userDoc = await db.collection("users").doc(reportedUserId).get();
  if (!userDoc.exists) {
    throw new Error("User not found");
  }

  const reportData = {
    reporterId,
    reportedUserId,
    reason,
    description: typeof description === "string" ? description.slice(0, 500) : "",
    status: "pending",           // pending | reviewed | dismissed
    createdAt: getTimestamp(),
  };

  await db.collection("Reports").add(reportData);
};

module.exports = { reportUser, REPORT_REASONS };
