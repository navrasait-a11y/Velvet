const { getDb, getTimestamp } = require("../config/firebase");
const { generateUserId } = require("../utils/generateUserId");
const { syncReverseContacts } = require("./contact.service");
const { logger } = require("../utils/logger");

/**
 * Atomically find or create a user by phone number.
 *
 * On NEW registration:
 *   1. Creates user doc
 *   2. Calls syncReverseContacts → finds all existing users who saved this
 *      phone number and writes the contact entry for them automatically.
 *      This means existing users can message the new user immediately
 *      without needing to re-open the app and re-sync contacts.
 */
const findOrCreateUser = async (phone) => {
  const db = getDb();
  const usersRef = db.collection("users");

  // Fast path — user already exists
  const snapshot = await usersRef.where("phone", "==", phone).limit(1).get();
  if (!snapshot.empty) {
    return { userId: snapshot.docs[0].data().userId, alreadyExists: true };
  }

  // Atomic creation via phone_index lock doc (prevents duplicate users
  // from concurrent OTP verifications for the same new phone number)
  const phoneIndexRef = db.collection("phone_index").doc(phone);

  let isNew = false;

  const userId = await db.runTransaction(async (tx) => {
    const indexDoc = await tx.get(phoneIndexRef);

    if (indexDoc.exists) {
      // Concurrent request already created this user
      return indexDoc.data().userId;
    }

    const newUserId = generateUserId();
    isNew = true;

    tx.set(phoneIndexRef, { userId: newUserId, phone, createdAt: getTimestamp() });
    tx.set(usersRef.doc(newUserId), {
      userId: newUserId,
      phone,
      createdAt: getTimestamp(),
    });

    return newUserId;
  });

  // After successful registration, trigger reverse contact sync.
  // Fire-and-forget — don't block the login response.
  if (isNew) {
    setImmediate(() => {
      syncReverseContacts(userId, phone).catch((err) =>
        logger.error("[User] syncReverseContacts failed:", err.message)
      );
    });
  }

  return { userId };
};

const findUserByPhone = async (phone) => {
  const snapshot = await getDb()
    .collection("users")
    .where("phone", "==", phone)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
};

module.exports = { findOrCreateUser, findUserByPhone };
