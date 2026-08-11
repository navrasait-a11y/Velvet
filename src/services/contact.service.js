/**
 * Contact Service — Mutual Contact Rule
 *
 * How it works:
 * ─────────────────────────────────────────────────────────────────────────────
 * Firestore collection: User_Contacts/{userId}/contacts/{contactUserId}
 *
 * This is a bidirectional index:
 *   - When User A syncs contacts and User B is on Velvet:
 *       User_Contacts/A/contacts/B  ← A has saved B
 *
 *   - When User B registers on Velvet and A already has B's number:
 *       Server-side: we look up phone_index to find A's userId,
 *       then write User_Contacts/A/contacts/B automatically.
 *       This is the key improvement — B doesn't need to open the app first.
 *
 * Mutual check: isMutualContact(A, B)
 *   → A/contacts/B exists  AND  B/contacts/A exists
 *   → Both must have saved each other's number
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Room-level caching:
 *   Once a room is created between two users, we cache `mutualVerified: true`
 *   on the room. Subsequent messages skip the Firestore check entirely —
 *   4 reads per message → 0 reads per message after first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getDb, getRealtimeDb } = require("../config/firebase");

const db = getDb();
const rtdb = getRealtimeDb();
const { logger } = require("../utils/logger");

// ─────────────────────────────────────────────────────────────────────────────
// Sync contacts — called when user calls /check-contact
// Writes A has B entry for each velvet user found in A's phonebook
// ─────────────────────────────────────────────────────────────────────────────
const syncContacts = async (userId, velvetUserIds) => {
  if (!velvetUserIds || velvetUserIds.length === 0) return;

  const BATCH_LIMIT = 400;

  for (let i = 0; i < velvetUserIds.length; i += BATCH_LIMIT) {
    const chunk = velvetUserIds.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();

    for (const contactUserId of chunk) {
      const ref = db
        .collection("User_Contacts")
        .doc(userId)
        .collection("contacts")
        .doc(contactUserId);

      batch.set(ref, { savedAt: Date.now() }, { merge: true });
    }

    await batch.commit();
  }
};

/**
 * Server-side reverse sync — called on NEW user registration.
 *
 * When User B (phone: 919876543210) registers:
 *   1. Find all users who have B's phone in User_Contacts via phone_index
 *   2. For each such user A → write User_Contacts/A/contacts/B
 *
 * This means A can immediately message B after B registers,
 * without A needing to re-open the app and re-sync contacts.
 *
 * @param {string} newUserId - The newly registered user's ID
 * @param {string} phone     - Their phone number (normalized, e.g. "919876543210")
 */
const syncReverseContacts = async (newUserId, phone) => {
  try {
    // Find all users who have saved this phone number
    // We stored phone → userId mapping in phone_index during registration
    // But to find "who saved this phone", we need to query User_Contacts
    // Since Firestore subcollection queries aren't straightforward,
    // we maintain a reverse index: Phone_Savers/{phone}/{saverUserId}: true
    // This is written during syncContacts (see syncContactsWithReverse below)

    const saversSnap = await db
      .collection("Phone_Savers")
      .doc(phone)
      .get();

    if (!saversSnap.exists) return;

    const savers = saversSnap.data() || {};
    const saverIds = Object.keys(savers);

    if (saverIds.length === 0) return;

    const BATCH_LIMIT = 400;
    for (let i = 0; i < saverIds.length; i += BATCH_LIMIT) {
      const chunk = saverIds.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();

      for (const saverUserId of chunk) {
        if (saverUserId === newUserId) continue;

        const ref = db
          .collection("User_Contacts")
          .doc(saverUserId)
          .collection("contacts")
          .doc(newUserId);

        batch.set(ref, { savedAt: Date.now() }, { merge: true });
      }

      await batch.commit();
    }
  } catch (err) {
    // Non-fatal — log but don't block registration
    logger.error("[Contact] syncReverseContacts error:", err.message);
  }
};

/**
 * Enhanced syncContacts — also writes to Phone_Savers reverse index.
 * Called from /check-contact.
 *
 * Phone_Savers/{phone}/{userId}: true
 * → Lets us find "who saved this number" when a new user registers.
 */
const syncContactsWithReverse = async (userId, velvetContacts) => {
  if (!velvetContacts || velvetContacts.length === 0) return;

  // velvetContacts: [{ userId, phone }]
  // Firestore batch limit is 500 operations — chunk if needed
  const BATCH_LIMIT = 400; // Leave headroom

  // Process in chunks
  for (let i = 0; i < velvetContacts.length; i += BATCH_LIMIT) {
    const chunk = velvetContacts.slice(i, i + BATCH_LIMIT);
    const forwardBatch = db.batch();
    const reverseBatch = db.batch();

    for (const contact of chunk) {
      // Forward: userId has contact.userId saved
      const forwardRef = db
        .collection("User_Contacts")
        .doc(userId)
        .collection("contacts")
        .doc(contact.userId);

      forwardBatch.set(forwardRef, { savedAt: Date.now() }, { merge: true });

      // Reverse index: contact.phone was saved by userId
      if (contact.phone) {
        const reverseRef = db
          .collection("Phone_Savers")
          .doc(contact.phone);

        reverseBatch.set(reverseRef, { [userId]: true }, { merge: true });
      }
    }

    await Promise.all([forwardBatch.commit(), reverseBatch.commit()]);
  }
};

/**
 * Records every phone number a user has saved, even when that phone is not
 * registered on Velvet yet. This lets reverse sync work when the owner of
 * that phone signs up later.
 */
const syncSavedPhoneIndex = async (userId, phones) => {
  if (!userId || !Array.isArray(phones) || phones.length === 0) return;

  const uniquePhones = [...new Set(phones.filter(Boolean))];
  const BATCH_LIMIT = 400;

  for (let i = 0; i < uniquePhones.length; i += BATCH_LIMIT) {
    const chunk = uniquePhones.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();

    for (const phone of chunk) {
      const ref = db.collection("Phone_Savers").doc(phone);
      batch.set(ref, { [userId]: true }, { merge: true });
    }

    await batch.commit();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// hasContact — check if userA has userB in their saved contacts
// ─────────────────────────────────────────────────────────────────────────────
const hasContact = async (userA, userB) => {
  const doc = await db
    .collection("User_Contacts")
    .doc(userA)
    .collection("contacts")
    .doc(userB)
    .get();

  return doc.exists;
};

// ─────────────────────────────────────────────────────────────────────────────
// isMutualContact — both must have each other saved
// Uses RTDB room cache to skip Firestore reads after first verification.
// ─────────────────────────────────────────────────────────────────────────────
const isMutualContact = async (userA, userB, roomId = null) => {
  // Check room-level cache first (0 Firestore reads after first message)
  if (roomId) {
    const cachedSnap = await rtdb
      .ref(`chatRooms/${roomId}/mutualVerified`)
      .once("value");

    if (cachedSnap.exists() && cachedSnap.val() === true) {
      return true;
    }
  }

  // Firestore check — run both in parallel
  const [aHasB, bHasA] = await Promise.all([
    hasContact(userA, userB),
    hasContact(userB, userA),
  ]);

  const mutual = aHasB && bHasA;

  // Cache result on the room so future messages skip this check
  if (mutual && roomId) {
    rtdb
      .ref(`chatRooms/${roomId}/mutualVerified`)
      .set(true)
      .catch((err) =>
        logger.error("[Contact] cache mutualVerified error:", err.message)
      );
  }

  return mutual;
};

// ─────────────────────────────────────────────────────────────────────────────
// removeContactEntry — called when a user blocks another
// Removes the contact entry so they can no longer message each other
// ─────────────────────────────────────────────────────────────────────────────
const removeContactEntry = async (userId, targetUserId) => {
  try {
    await db
      .collection("User_Contacts")
      .doc(userId)
      .collection("contacts")
      .doc(targetUserId)
      .delete();
  } catch (err) {
    logger.error("[Contact] removeContactEntry error:", err.message);
  }
};

module.exports = {
  syncContacts,
  syncContactsWithReverse,
  syncSavedPhoneIndex,
  syncReverseContacts,
  hasContact,
  isMutualContact,
  removeContactEntry,
};
