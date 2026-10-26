const { getDb } = require("../config/firebase");
const { uploadPublicImage } = require("../utils/uploads");
const {
  syncContactsWithReverse,
  syncSavedPhoneIndex,
} = require("../services/contact.service");
const { logger } = require("../utils/logger");
const { ABOUT_VISIBILITIES } = require("../validations/user.validation");
const { isEmojiOnlyAbout, parseAboutExpiry, isAboutStatusActive } = require("../utils/aboutStatus");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const chunkArray = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const normalizePhoneNumber = (phone) => {
  if (!phone) return "";
  phone = String(phone).replace(/\D/g, "");
  if (phone.startsWith("0")) phone = phone.substring(1);
  if (phone.length === 10) phone = "91" + phone;
  if (phone.length === 12 && phone.startsWith("91")) return phone;
  return ""; // Invalid — discard
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const getAboutUpdates = async (db, userId, body, isCreate = false) => {
  const updates = {};

  if (hasOwn(body, "aboutStatus")) {
    if (typeof body.aboutStatus !== "string" || !isEmojiOnlyAbout(body.aboutStatus)) {
      const error = new Error("aboutStatus must contain only emoji");
      error.status = 400;
      throw error;
    }
    updates.aboutStatus = body.aboutStatus.trim();
  } else if (isCreate) {
    updates.aboutStatus = "";
  }

  if (hasOwn(body, "aboutVisibility")) {
    if (!ABOUT_VISIBILITIES.includes(body.aboutVisibility)) {
      const error = new Error("Invalid aboutVisibility");
      error.status = 400;
      throw error;
    }
    updates.aboutVisibility = body.aboutVisibility;
  } else if (isCreate) {
    updates.aboutVisibility = "everyone";
  }

  if (hasOwn(body, "aboutExcludedContacts")) {
    let requestedContacts = body.aboutExcludedContacts;
    if (typeof requestedContacts === "string") {
      try {
        requestedContacts = JSON.parse(requestedContacts);
      } catch {
        requestedContacts = null;
      }
    }
    if (
      !Array.isArray(requestedContacts) ||
      requestedContacts.length > 100
    ) {
      const error = new Error("aboutExcludedContacts must be an array of up to 100 user IDs");
      error.status = 400;
      throw error;
    }
    const excludedContacts = [...new Set(requestedContacts)];
    if (excludedContacts.some((id) => typeof id !== "string" || !id || id.length > 100)) {
      const error = new Error("Each excluded contact must be a valid user ID");
      error.status = 400;
      throw error;
    }

    if (excludedContacts.length > 0) {
      const contactRefs = excludedContacts.map((contactId) =>
        db.collection("User_Contacts").doc(userId).collection("contacts").doc(contactId)
      );
      const contactDocs = await db.getAll(...contactRefs);
      if (contactDocs.some((doc) => !doc.exists)) {
        const error = new Error("Excluded users must be in your contacts");
        error.status = 400;
        throw error;
      }
    }
    updates.aboutExcludedContacts = excludedContacts;
  } else if (isCreate) {
    updates.aboutExcludedContacts = [];
  }

  if (hasOwn(body, "aboutExpiresAt")) {
    try {
      updates.aboutExpiresAt = parseAboutExpiry(body.aboutExpiresAt);
    } catch (error) {
      error.status = 400;
      throw error;
    }
  } else if (isCreate) {
    updates.aboutExpiresAt = null;
  }

  return updates;
};

const canViewAboutStatus = async (db, profileUserId, viewerId, profile) => {
  if (viewerId === profileUserId) return true;
  if (!isAboutStatusActive(profile)) return false;

  const visibility = profile.aboutVisibility || "everyone";
  if (visibility === "nobody") return false;
  if (visibility === "everyone") return true;
  if (!["contacts", "contacts_except"].includes(visibility)) return false;

  const contactDoc = await db
    .collection("User_Contacts")
    .doc(profileUserId)
    .collection("contacts")
    .doc(viewerId)
    .get();
  if (!contactDoc.exists) return false;
  if (visibility === "contacts") return true;
  return !(profile.aboutExcludedContacts || []).includes(viewerId);
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE PROFILE
// ─────────────────────────────────────────────────────────────────────────────
exports.createProfile = async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;
    const { name, bio } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (bio !== undefined && typeof bio !== "string") {
      return res.status(400).json({ success: false, message: "bio must be a string" });
    }

    const userRef = db.collection("Users_Profile").doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      return res.status(400).json({ success: false, message: "Profile already exists" });
    }

    const aboutUpdates = await getAboutUpdates(db, userId, req.body, true);
    let profileImage = null;
    if (req.files?.profileImage?.[0]) {
      profileImage = await uploadPublicImage(req.files.profileImage[0], "profiles");
    }

    let bannerImage = null;
    if (req.files?.bannerImage?.[0]) {
      bannerImage = await uploadPublicImage(req.files.bannerImage[0], "banners");
    }

    const profileData = {
      userId,
      name: name.trim(),
      bio: bio?.trim() || "",
      profileImage: profileImage || null,
      bannerImage: bannerImage || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    Object.assign(profileData, aboutUpdates);

    await userRef.set(profileData);

    return res.status(201).json({
      success: true,
      message: "Profile created successfully",
      data: profileData,
    });
  } catch (err) {
    logger.error("CREATE PROFILE ERROR:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : "Failed to create profile",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PROFILE
// ─────────────────────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;
    const { name, bio } = req.body;

    const userRef = db.collection("Users_Profile").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    const existingData = userDoc.data();
    const updatedData = { updatedAt: new Date().toISOString() };

    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).json({ success: false, message: "name must be a string" });
      }
      updatedData.name = name.trim();
    }
    if (bio !== undefined) {
      if (typeof bio !== "string") {
        return res.status(400).json({ success: false, message: "bio must be a string" });
      }
      updatedData.bio = bio.trim();
    }

    Object.assign(updatedData, await getAboutUpdates(db, userId, req.body));

    if (req.files?.profileImage?.[0]) {
      updatedData.profileImage = await uploadPublicImage(req.files.profileImage[0], "profiles");
    }
    if (req.files?.bannerImage?.[0]) {
      updatedData.bannerImage = await uploadPublicImage(req.files.bannerImage[0], "banners");
    }

    await userRef.update(updatedData);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { ...existingData, ...updatedData },
    });
  } catch (err) {
    logger.error("UPDATE PROFILE ERROR:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : "Failed to update profile",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET MY PROFILE
// ─────────────────────────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.userId;

    const [profileDoc, userDoc] = await Promise.all([
      db.collection("Users_Profile").doc(userId).get(),
      db.collection("users").doc(userId).get(),
    ]);

    if (!profileDoc.exists) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    const profileData = profileDoc.data();
    const userData = userDoc.exists ? userDoc.data() : {};

    return res.status(200).json({
      success: true,
      data: {
        userId,
        name: profileData.name || "",
        profileImage: profileData.profileImage || null,
        bannerImage: profileData.bannerImage || null,
        bio: profileData.bio || "",
        aboutStatus: isAboutStatusActive(profileData) ? profileData.aboutStatus : "",
        aboutVisibility: profileData.aboutVisibility || "everyone",
        aboutExcludedContacts: profileData.aboutExcludedContacts || [],
        aboutExpiresAt: profileData.aboutExpiresAt ?? null,
        phone: userData.phone || null,
        createdAt: profileData.createdAt || null,
        updatedAt: profileData.updatedAt || null,
      },
    });
  } catch (err) {
    logger.error("GET PROFILE ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to get profile" });
  }
};

exports.getNotificationPreferences = async (req, res) => {
  try {
    const userDoc = await getDb().collection("users").doc(req.user.userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        pushNotificationsEnabled: userDoc.data().pushNotificationsEnabled !== false,
      },
    });
  } catch (err) {
    logger.error("GET NOTIFICATION PREFERENCES ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to get notification preferences" });
  }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const userRef = getDb().collection("users").doc(req.user.userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { pushNotificationsEnabled } = req.body;
    await userRef.update({
      pushNotificationsEnabled,
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      data: { pushNotificationsEnabled },
    });
  } catch (err) {
    logger.error("UPDATE NOTIFICATION PREFERENCES ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to update notification preferences" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ANY USER'S PUBLIC PROFILE — no phone number exposed
// ─────────────────────────────────────────────────────────────────────────────
exports.getUserProfile = async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    const profileDoc = await db.collection("Users_Profile").doc(userId).get();

    if (!profileDoc.exists) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    const profileData = profileDoc.data();
    const mayViewAbout = await canViewAboutStatus(db, userId, req.user.userId, profileData);

    return res.status(200).json({
      success: true,
      data: {
        userId,
        name: profileData.name || "",
        profileImage: profileData.profileImage || null,
        bio: profileData.bio || "",
        ...(mayViewAbout
          ? {
              aboutStatus: isAboutStatusActive(profileData) ? profileData.aboutStatus : "",
            }
          : {}),
      },
    });
  } catch (err) {
    logger.error("GET USER PROFILE ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to get profile" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CHECK & SYNC CONTACTS
// ─────────────────────────────────────────────────────────────────────────────
exports.checkcontact = async (req, res) => {
  try {
    const db = getDb();
    const currentUserId = req.user.userId;
    const { contacts } = req.body;

    if (!Array.isArray(contacts)) {
      return res.status(400).json({ success: false, message: "contacts must be an array" });
    }

    if (contacts.length === 0) {
      return res.status(200).json({
        success: true,
        totalContacts: 0,
        velvetUsers: 0,
        inviteUsers: 0,
        registeredUsers: [],
        unregisteredContacts: [],
      });
    }

    if (contacts.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Maximum 1000 contacts per request",
      });
    }

    // Normalize and deduplicate
    const contactMap = new Map();
    for (const contact of contacts) {
      if (!contact) continue;
      const phone = normalizePhoneNumber(contact.phone);
      if (!phone) continue;
      if (!contactMap.has(phone)) {
        contactMap.set(phone, contact.name || "");
      }
    }

    if (contactMap.size === 0) {
      return res.status(200).json({
        success: true, totalContacts: 0, velvetUsers: 0,
        inviteUsers: 0, registeredUsers: [], unregisteredContacts: [],
      });
    }

    const phoneNumbers = [...contactMap.keys()];
    const batches = chunkArray(phoneNumbers, 30);

    // Parallel batch queries
    const snapshots = await Promise.all(
      batches.map((batch) =>
        db.collection("users").where("phone", "in", batch).get()
      )
    );

    const registeredUsers = [];
    const matchedNumbers = new Set();

    // Collect userIds to batch-fetch profiles
    const userDocs = [];
    snapshots.forEach((snapshot) => {
      snapshot.forEach((doc) => {
        if (doc.id === currentUserId) return;
        userDocs.push(doc);
        matchedNumbers.add(doc.data().phone);
      });
    });

    // Batch-fetch all profiles at once instead of one by one (N+1 fix)
    if (userDocs.length > 0) {
      const profileRefs = userDocs.map((doc) =>
        db.collection("Users_Profile").doc(doc.id)
      );
      const profileChunks = chunkArray(profileRefs, 30);
      const profileSnaps = await Promise.all(
        profileChunks.map((chunk) => db.getAll(...chunk))
      );
      const profileMap = new Map();
      profileSnaps.flat().forEach((snap) => {
        if (snap.exists) profileMap.set(snap.id, snap.data());
      });

      userDocs.forEach((doc) => {
        const user = doc.data();
        const profile = profileMap.get(doc.id) || {};
        registeredUsers.push({
          userId: doc.id,
          phone: user.phone,
          name: profile.name || "",
          profileImage: profile.profileImage || null,
          savedName: contactMap.get(user.phone) || "",
        });
      });
    }

    const unregisteredContacts = phoneNumbers
      .filter((p) => !matchedNumbers.has(p))
      .map((p) => ({ phone: p, savedName: contactMap.get(p) || "" }));

    registeredUsers.sort((a, b) =>
      (a.savedName || a.name).localeCompare(b.savedName || b.name)
    );

    // Store every saved phone so future signups can be reverse-synced.
    await syncSavedPhoneIndex(currentUserId, phoneNumbers);

    // Sync registered contacts for mutual contact rule before responding, so
    // chat APIs called immediately after /check-contact see the new state.
    const velvetUserContacts = registeredUsers.map((u) => ({
      userId: u.userId,
      phone: u.phone,
    }));
    await syncContactsWithReverse(currentUserId, velvetUserContacts);

    return res.status(200).json({
      success: true,
      totalContacts: contactMap.size,
      velvetUsers: registeredUsers.length,
      inviteUsers: unregisteredContacts.length,
      registeredUsers,
      unregisteredContacts,
    });
  } catch (err) {
    logger.error("CHECK CONTACT ERROR:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
