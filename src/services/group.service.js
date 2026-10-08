const { getRealtimeDb, getDb } = require("../config/firebase");
const {
  notifyNewGroupMessage,
  notifyGroupInvitation,
} = require("./notification.service");
const { logger } = require("../utils/logger");

const rtdb = getRealtimeDb();
const db = getDb();

const MAX_GROUP_MEMBERS = 256;
const MAX_MESSAGES_PER_PAGE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches a group snapshot; throws if not found.
 */
const fetchGroup = async (groupId) => {
  const snap = await rtdb.ref(`groups/${groupId}`).once("value");
  if (!snap.exists()) throw new Error("Group not found");
  return snap.val();
};

/**
 * Checks if userId is an admin of the group.
 */
const assertAdmin = (group, userId) => {
  if (!group.admins?.[userId]) {
    throw new Error("Only admins can perform this action");
  }
};

/**
 * Fetches profile + phone for a userId.
 * Accepts pre-fetched maps to avoid N+1 reads when called in bulk.
 */
const fetchMemberProfile = async (userId, showPhone = true, profileMap = null, userDataMap = null) => {
  try {
    let profileData, userData;

    if (profileMap && userDataMap) {
      // Use pre-fetched data (batch mode)
      profileData = profileMap.get(userId);
      userData = userDataMap.get(userId) || {};
    } else {
      // Single fetch fallback
      const [profileDoc, userDoc] = await Promise.all([
        db.collection("Users_Profile").doc(userId).get(),
        db.collection("users").doc(userId).get(),
      ]);
      if (!profileDoc.exists) return { userId };
      profileData = profileDoc.data();
      userData = userDoc.exists ? userDoc.data() : {};
    }

    if (!profileData) return { userId };

    return {
      userId,
      name: profileData.name || "",
      profileImage: profileData.profileImage || null,
      ...(showPhone ? { phone: userData.phone || "" } : {}),
    };
  } catch (err) {
    logger.error("fetchMemberProfile error:", err.message);
    return { userId };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Create Group
// Creator is auto-added as admin with status "accepted".
// Invited members get status "pending" — they must accept to join.
// ─────────────────────────────────────────────────────────────────────────────
exports.createGroup = async ({
  createdBy,
  groupName,
  groupBio,
  groupImage,
  backgroundImage,
  members,
}) => {
  const groupRef = rtdb.ref("groups").push();
  const groupId = groupRef.key;
  const timestamp = Date.now();

  // groupImage/backgroundImage may be upload objects {url, storagePath...} or ""
  // Store only the URL string in RTDB for lean data
  const groupImageUrl = groupImage?.url || groupImage || "";
  const backgroundImageUrl = backgroundImage?.url || backgroundImage || "";

  // Deduplicate and exclude creator (they're added separately)
  const inviteList = [...new Set(members)].filter((id) => id !== createdBy);

  // Enforce max group size (creator + invitees)
  if (inviteList.length >= MAX_GROUP_MEMBERS) {
    throw new Error(`Group cannot have more than ${MAX_GROUP_MEMBERS} members`);
  }

  const memberObject = {
    [createdBy]: {
      userId: createdBy,
      role: "admin",
      status: "accepted",
      joinedAt: timestamp,
    },
  };

  inviteList.forEach((userId) => {
    memberObject[userId] = {
      userId,
      role: "member",
      status: "pending",     // Must accept invitation
      invitedBy: createdBy,
      invitedAt: timestamp,
      joinedAt: null,
    };
  });

  const updates = {};

  updates[`groups/${groupId}`] = {
    groupId,
    groupName,
    groupBio: groupBio || "",
    groupImage: groupImageUrl,
    backgroundImage: backgroundImageUrl,
    createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
    admins: { [createdBy]: true },
    settings: { showPhoneNumbers: true },
    members: memberObject,
  };

  // Only creator gets the group in their userGroups (others join after accepting)
  updates[`userGroups/${createdBy}/${groupId}`] = true;

  // Creator also gets a userGroupChats entry immediately
  updates[`userGroupChats/${createdBy}/${groupId}/groupId`] = groupId;
  updates[`userGroupChats/${createdBy}/${groupId}/groupName`] = groupName;
  updates[`userGroupChats/${createdBy}/${groupId}/groupImage`] = groupImageUrl;
  updates[`userGroupChats/${createdBy}/${groupId}/lastMessage`] = "";
  updates[`userGroupChats/${createdBy}/${groupId}/lastMessageType`] = "";
  updates[`userGroupChats/${createdBy}/${groupId}/lastMessageSender`] = "";
  updates[`userGroupChats/${createdBy}/${groupId}/updatedAt`] = timestamp;
  updates[`userGroupChats/${createdBy}/${groupId}/unreadCount`] = 0;

  // Add pending invites to the groupInvites index for efficient lookup
  inviteList.forEach((userId) => {
    updates[`groupInvites/${userId}/${groupId}`] = true;
  });

  await rtdb.ref().update(updates);

  // FCM: notify each invitee about the group invitation — fire and forget
  if (inviteList.length > 0) {
    setImmediate(async () => {
      try {
        const creatorDoc = await db.collection("Users_Profile").doc(createdBy).get();
        const creatorName = creatorDoc.exists ? creatorDoc.data().name || "Someone" : "Someone";

        await Promise.all(
          inviteList.map((inviteeId) =>
            notifyGroupInvitation({ inviteeId, inviterName: creatorName, groupName, groupId })
          )
        );
      } catch (err) {
        logger.error("[FCM] group invite notification error:", err.message);
      }
    });
  }

  return {
    groupId,
    groupName,
    groupBio: groupBio || "",
    groupImage: groupImageUrl,
    backgroundImage: backgroundImageUrl,
    invitedCount: inviteList.length,
    skippedCount: 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Get pending invitations for a user
// ─────────────────────────────────────────────────────────────────────────────
exports.getPendingInvitations = async (userId) => {
  const snap = await rtdb.ref(`groupInvites/${userId}`).once("value");
  if (!snap.exists()) return [];

  const inviteData = snap.val();
  const groupIds = Object.keys(inviteData);

  // Fetch all groups in parallel
  const groupSnaps = await Promise.all(
    groupIds.map((id) => rtdb.ref(`groups/${id}`).once("value"))
  );

  // Collect unique inviter IDs for batch profile fetch
  const inviterIds = new Set();
  const validGroups = [];

  groupSnaps.forEach((groupSnap, idx) => {
    if (!groupSnap.exists()) return;
    const group = groupSnap.val();
    const memberEntry = group.members?.[userId];
    if (!memberEntry || memberEntry.status !== "pending") return;

    if (memberEntry.invitedBy) inviterIds.add(memberEntry.invitedBy);
    validGroups.push({ groupId: groupIds[idx], group, memberEntry });
  });

  // Batch fetch all inviter profiles
  const profileMap = new Map();
  const inviterIdArray = [...inviterIds];

  if (inviterIdArray.length > 0) {
    const profileDocs = await db.getAll(
      ...inviterIdArray.map((id) => db.collection("Users_Profile").doc(id))
    );
    profileDocs.forEach((doc) => { if (doc.exists) profileMap.set(doc.id, doc.data()); });
  }

  const invites = validGroups.map(({ groupId, group, memberEntry }) => {
    let inviterProfile = {};
    if (memberEntry.invitedBy) {
      const pd = profileMap.get(memberEntry.invitedBy);
      inviterProfile = pd
        ? { userId: memberEntry.invitedBy, name: pd.name || "", profileImage: pd.profileImage || null }
        : { userId: memberEntry.invitedBy };
    }

    return {
      groupId,
      groupName: group.groupName,
      groupImage: group.groupImage || "",
      invitedBy: inviterProfile,
      invitedAt: memberEntry.invitedAt,
    };
  });

  return invites;
};

// ─────────────────────────────────────────────────────────────────────────────
// Accept group invitation
// ─────────────────────────────────────────────────────────────────────────────
exports.acceptInvitation = async (userId, groupId) => {
  const group = await fetchGroup(groupId);

  const member = group.members?.[userId];
  if (!member) throw new Error("No invitation found");
  if (member.status !== "pending") throw new Error("Invitation already processed");

  const timestamp = Date.now();
  const updates = {};

  updates[`groups/${groupId}/members/${userId}/status`] = "accepted";
  updates[`groups/${groupId}/members/${userId}/joinedAt`] = timestamp;
  updates[`groups/${groupId}/updatedAt`] = timestamp;
  updates[`userGroups/${userId}/${groupId}`] = true;
  updates[`groupInvites/${userId}/${groupId}`] = null; // Remove invite

  // Create userGroupChats entry so the group appears in the user's group chat list
  updates[`userGroupChats/${userId}/${groupId}/groupId`] = groupId;
  updates[`userGroupChats/${userId}/${groupId}/groupName`] = group.groupName;
  updates[`userGroupChats/${userId}/${groupId}/groupImage`] = group.groupImage || "";
  updates[`userGroupChats/${userId}/${groupId}/lastMessage`] = group.lastMessage || "";
  updates[`userGroupChats/${userId}/${groupId}/lastMessageType`] = group.lastMessageType || "";
  updates[`userGroupChats/${userId}/${groupId}/lastMessageSender`] = group.lastMessageSender || "";
  updates[`userGroupChats/${userId}/${groupId}/updatedAt`] = group.updatedAt || timestamp;
  updates[`userGroupChats/${userId}/${groupId}/unreadCount`] = 0;

  await rtdb.ref().update(updates);
};

// ─────────────────────────────────────────────────────────────────────────────
// Reject group invitation
// ─────────────────────────────────────────────────────────────────────────────
exports.rejectInvitation = async (userId, groupId) => {
  const group = await fetchGroup(groupId);

  const member = group.members?.[userId];
  if (!member) throw new Error("No invitation found");
  if (member.status !== "pending") throw new Error("Invitation already processed");

  const updates = {};
  updates[`groups/${groupId}/members/${userId}`] = null; // Remove from members
  updates[`groupInvites/${userId}/${groupId}`] = null;   // Remove invite

  await rtdb.ref().update(updates);
};

// ─────────────────────────────────────────────────────────────────────────────
// Add members to group (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.addMembers = async (adminId, groupId, newMemberIds) => {
  const group = await fetchGroup(groupId);
  assertAdmin(group, adminId);

  // Check current accepted member count against cap
  const currentAcceptedCount = Object.values(group.members || {}).filter(
    (m) => m.status === "accepted"
  ).length;

  if (currentAcceptedCount >= MAX_GROUP_MEMBERS) {
    throw new Error(`Group has reached the maximum of ${MAX_GROUP_MEMBERS} members`);
  }

  const timestamp = Date.now();
  const updates = {};
  const results = { invited: [], skipped: [] };
  let slotsRemaining = MAX_GROUP_MEMBERS - currentAcceptedCount;

  // Pre-filter: remove already-members, pending, and full slots
  const candidateIds = [];
  for (const memberId of newMemberIds) {
    if (slotsRemaining <= 0) {
      results.skipped.push({ userId: memberId, reason: "group_full" });
      continue;
    }

    const existing = group.members?.[memberId];
    if (existing && existing.status === "accepted") {
      results.skipped.push({ userId: memberId, reason: "already_member" });
      continue;
    }

    if (existing && existing.status === "pending") {
      results.skipped.push({ userId: memberId, reason: "invite_already_sent" });
      continue;
    }

    candidateIds.push(memberId);
  }

  // Process results
  for (let i = 0; i < candidateIds.length; i++) {
    if (slotsRemaining <= 0) {
      results.skipped.push({ userId: candidateIds[i], reason: "group_full" });
      continue;
    }

    updates[`groups/${groupId}/members/${candidateIds[i]}`] = {
      userId: candidateIds[i],
      role: "member",
      status: "pending",
      invitedBy: adminId,
      invitedAt: timestamp,
      joinedAt: null,
    };

    updates[`groupInvites/${candidateIds[i]}/${groupId}`] = true;
    results.invited.push(candidateIds[i]);
    slotsRemaining--;
  }

  if (Object.keys(updates).length > 0) {
    updates[`groups/${groupId}/updatedAt`] = timestamp;
    await rtdb.ref().update(updates);

    if (results.invited.length > 0) {
      setImmediate(async () => {
        try {
          const adminDoc = await db.collection("Users_Profile").doc(adminId).get();
          const adminName = adminDoc.exists ? adminDoc.data().name || "Admin" : "Admin";

          await Promise.all(
            results.invited.map((inviteeId) =>
              notifyGroupInvitation({
                inviteeId,
                inviterName: adminName,
                groupName: group.groupName,
                groupId,
              })
            )
          );
        } catch (err) {
          logger.error("[FCM] addMembers notification error:", err.message);
        }
      });
    }
  }

  return results;
};

// ─────────────────────────────────────────────────────────────────────────────
// Remove member from group (admin only, cannot remove other admins)
// ─────────────────────────────────────────────────────────────────────────────
exports.removeMember = async (adminId, groupId, targetUserId) => {
  const group = await fetchGroup(groupId);
  assertAdmin(group, adminId);

  if (adminId === targetUserId) {
    throw new Error("Admin cannot remove themselves. Transfer admin role first.");
  }

  // Cannot remove another admin
  if (group.admins?.[targetUserId]) {
    throw new Error("Cannot remove another admin");
  }

  const member = group.members?.[targetUserId];
  if (!member) throw new Error("User is not a member of this group");

  const updates = {};
  updates[`groups/${groupId}/members/${targetUserId}`] = null;
  updates[`groups/${groupId}/updatedAt`] = Date.now();
  updates[`userGroups/${targetUserId}/${groupId}`] = null;
  updates[`groupInvites/${targetUserId}/${groupId}`] = null;
  updates[`userGroupChats/${targetUserId}/${groupId}`] = null; // Remove from chat list

  await rtdb.ref().update(updates);
};

// ─────────────────────────────────────────────────────────────────────────────
// Toggle showPhoneNumbers setting (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateShowPhoneNumbers = async (adminId, groupId, showPhoneNumbers) => {
  const group = await fetchGroup(groupId);
  assertAdmin(group, adminId);

  await rtdb.ref(`groups/${groupId}/settings/showPhoneNumbers`).set(showPhoneNumbers);
  await rtdb.ref(`groups/${groupId}/updatedAt`).set(Date.now());
};

// ─────────────────────────────────────────────────────────────────────────────
// Transfer admin role to another accepted member
// ─────────────────────────────────────────────────────────────────────────────
exports.transferAdmin = async (currentAdminId, groupId, newAdminId) => {
  const group = await fetchGroup(groupId);

  if (!group.admins?.[currentAdminId]) {
    throw new Error("Only admins can transfer admin role");
  }

  if (currentAdminId === newAdminId) {
    throw new Error("Cannot transfer admin role to yourself");
  }

  const targetMember = group.members?.[newAdminId];
  if (!targetMember || targetMember.status !== "accepted") {
    throw new Error("Target user is not an accepted member of this group");
  }

  const timestamp = Date.now();
  const updates = {};

  updates[`groups/${groupId}/admins/${newAdminId}`] = true;
  updates[`groups/${groupId}/admins/${currentAdminId}`] = null;
  updates[`groups/${groupId}/members/${newAdminId}/role`] = "admin";
  updates[`groups/${groupId}/members/${currentAdminId}/role`] = "member";
  updates[`groups/${groupId}/updatedAt`] = timestamp;

  await rtdb.ref().update(updates);
};

// ─────────────────────────────────────────────────────────────────────────────
// Leave group
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveGroup = async (userId, groupId) => {
  const group = await fetchGroup(groupId);

  const member = group.members?.[userId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  if (group.admins?.[userId]) {
    const adminCount = Object.keys(group.admins).length;
    const acceptedCount = Object.values(group.members).filter(
      (m) => m.status === "accepted"
    ).length;

    if (adminCount === 1 && acceptedCount > 1) {
      throw new Error("Transfer admin role before leaving the group");
    }
  }

  const updates = {};
  updates[`groups/${groupId}/members/${userId}`] = null;
  updates[`groups/${groupId}/updatedAt`] = Date.now();
  updates[`userGroups/${userId}/${groupId}`] = null;
  updates[`userGroupChats/${userId}/${groupId}`] = null;

  if (group.admins?.[userId]) {
    updates[`groups/${groupId}/admins/${userId}`] = null;
  }

  await rtdb.ref().update(updates);
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete group for me — leaves group AND marks it as deleted so old messages
// are also hidden from the user's view.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupForMe = async (userId, groupId) => {
  const group = await fetchGroup(groupId);
  const member = group.members?.[userId];

  if (member && member.status === "accepted") {
    const updates = {};
    updates[`groups/${groupId}/members/${userId}`] = null;
    updates[`groups/${groupId}/updatedAt`] = Date.now();
    updates[`userGroups/${userId}/${groupId}`] = null;
    updates[`userGroupChats/${userId}/${groupId}`] = null;

    if (group.admins?.[userId]) {
      updates[`groups/${groupId}/admins/${userId}`] = null;
    }

    await rtdb.ref().update(updates);
  }

  await rtdb.ref(`deletedGroups/${userId}/${groupId}`).set(Date.now());
};

// ─────────────────────────────────────────────────────────────────────────────
// Get My Groups — fetch all in parallel (N+1 fix)
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyGroups = async (userId) => {
  const snapshot = await rtdb.ref(`userGroups/${userId}`).once("value");
  if (!snapshot.exists()) return [];

  const groupIds = Object.keys(snapshot.val());

  const deletedSnap = await rtdb.ref(`deletedGroups/${userId}`).once("value");
  const deletedGroupIds = deletedSnap.exists() ? Object.keys(deletedSnap.val()) : [];

  const filteredGroupIds = groupIds.filter((id) => !deletedGroupIds.includes(id));
  if (filteredGroupIds.length === 0) return [];

  const groupSnaps = await Promise.all(
    filteredGroupIds.map((id) => rtdb.ref(`groups/${id}`).once("value"))
  );

  const groups = [];

  for (const groupSnap of groupSnaps) {
    if (!groupSnap.exists()) continue;

    const group = groupSnap.val();
    const member = group.members?.[userId];
    if (!member || member.status !== "accepted") continue;

    groups.push({
      groupId: group.groupId,
      groupName: group.groupName,
      groupBio: group.groupBio || "",
      groupImage: group.groupImage || "",
      backgroundImage: group.backgroundImage || "",
      createdBy: group.createdBy,
      memberCount: Object.values(group.members || {}).filter(
        (m) => m.status === "accepted"
      ).length,
      isAdmin: !!group.admins?.[userId],
      lastMessage: group.lastMessage || "",
      lastMessageTime: group.lastMessageTime || 0,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    });
  }

  groups.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
};

// ─────────────────────────────────────────────────────────────────────────────
// Group Details — batch profile fetch (N+1 fix)
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupDetails = async (groupId, requestingUserId) => {
  const group = await fetchGroup(groupId);

  const requester = group.members?.[requestingUserId];
  if (!requester || requester.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const showPhone = group.settings?.showPhoneNumbers !== false;

  // Collect accepted member IDs
  const acceptedMemberIds = Object.keys(group.members || {}).filter(
    (uid) => group.members[uid].status === "accepted"
  );

  // Batch fetch all profiles and user docs at once
  const profileMap = new Map();
  const userDataMap = new Map();

  if (acceptedMemberIds.length > 0) {
    const chunkSize = 30;
    const idChunks = [];
    for (let i = 0; i < acceptedMemberIds.length; i += chunkSize) {
      idChunks.push(acceptedMemberIds.slice(i, i + chunkSize));
    }

    const [profileResults, userResults] = await Promise.all([
      Promise.all(
        idChunks.map((chunk) =>
          db.getAll(...chunk.map((id) => db.collection("Users_Profile").doc(id)))
        )
      ),
      Promise.all(
        idChunks.map((chunk) =>
          db.getAll(...chunk.map((id) => db.collection("users").doc(id)))
        )
      ),
    ]);

    profileResults.flat().forEach((doc) => { if (doc.exists) profileMap.set(doc.id, doc.data()); });
    userResults.flat().forEach((doc) => { if (doc.exists) userDataMap.set(doc.id, doc.data()); });
  }

  const members = acceptedMemberIds.map((uid) => {
    const memberEntry = group.members[uid];
    const pd = profileMap.get(uid);
    const ud = userDataMap.get(uid) || {};

    return {
      userId: uid,
      role: memberEntry.role,
      joinedAt: memberEntry.joinedAt,
      profile: pd ? {
        userId: uid,
        name: pd.name || "",
        profileImage: pd.profileImage || null,
        ...(showPhone ? { phone: ud.phone || "" } : {}),
      } : { userId: uid },
    };
  });

  return {
    groupId: group.groupId,
    groupName: group.groupName,
    groupBio: group.groupBio || "",
    groupImage: group.groupImage || "",
    backgroundImage: group.backgroundImage || "",
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    settings: group.settings || { showPhoneNumbers: true },
    isAdmin: !!group.admins?.[requestingUserId],
    memberCount: members.length,
    members,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Group Message
// Only accepted members can send.
// Link filtering is handled at middleware level.
// ─────────────────────────────────────────────────────────────────────────────
exports.sendGroupMessage = async ({
  groupId,
  senderId,
  message,
  type = "text",
  media = null,
}) => {
  const group = await fetchGroup(groupId);

  // Membership check
  const member = group.members?.[senderId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const messageRef = rtdb.ref(`groupMessages/${groupId}`).push();
  const messageId = messageRef.key;
  const timestamp = Date.now();

  const messageData = {
    messageId,
    groupId,
    senderId,
    type,
    text: type === "text" ? message : null,
    media: media || null,
    status: "sent",
    createdAt: timestamp,
    deletedFor: {},
    deletedForEveryone: false,
    deletedAt: null,
  };

  const updates = {};

  // Save message
  updates[`groupMessages/${groupId}/${messageId}`] = messageData;

  // Update group meta (last message)
  updates[`groups/${groupId}/lastMessage`] = type === "text" ? message : `[${type}]`;
  updates[`groups/${groupId}/lastMessageType`] = type;
  updates[`groups/${groupId}/lastMessageSender`] = senderId;
  updates[`groups/${groupId}/lastMessageTime`] = timestamp;
  updates[`groups/${groupId}/updatedAt`] = timestamp;

  // Update each accepted member's userGroups entry with last message info
  // and increment unread count for everyone except sender
  const acceptedMembers = Object.values(group.members).filter(
    (m) => m.status === "accepted"
  );

  for (const m of acceptedMembers) {
    updates[`userGroupChats/${m.userId}/${groupId}/groupId`] = groupId;
    updates[`userGroupChats/${m.userId}/${groupId}/groupName`] = group.groupName;
    updates[`userGroupChats/${m.userId}/${groupId}/groupImage`] = group.groupImage || "";
    updates[`userGroupChats/${m.userId}/${groupId}/lastMessage`] = type === "text" ? message : `[${type}]`;
    updates[`userGroupChats/${m.userId}/${groupId}/lastMessageType`] = type;
    updates[`userGroupChats/${m.userId}/${groupId}/lastMessageSender`] = senderId;
    updates[`userGroupChats/${m.userId}/${groupId}/updatedAt`] = timestamp;
  }

  await rtdb.ref().update(updates);

  // Increment unread count atomically for all members except sender
  const unreadIncrements = acceptedMembers
    .filter((m) => m.userId !== senderId)
    .map((m) =>
      rtdb
        .ref(`userGroupChats/${m.userId}/${groupId}/unreadCount`)
        .transaction((count) => (count || 0) + 1)
    );

  await Promise.all(unreadIncrements);

  // FCM: push to all members except sender — fire and forget
  setImmediate(async () => {
    try {
      const senderDoc = await db
        .collection("Users_Profile")
        .doc(senderId)
        .get();
      const senderName =
        senderDoc.exists
          ? senderDoc.data().name || "Velvet User"
          : "Velvet User";

      const otherMemberIds = acceptedMembers
        .filter((m) => m.userId !== senderId)
        .map((m) => m.userId);

      await notifyNewGroupMessage({
        groupId,
        groupName: group.groupName,
        senderName,
        message: type === "text" ? message : "",
        type,
        memberIds: otherMemberIds,
      });
    } catch (err) {
      logger.error("[FCM] group message notification error:", err.message);
    }
  });

  return messageData;
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Group Messages (paginated, newest-first)
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupMessages = async (groupId, userId, limit = 20, lastKey = null) => {
  const group = await fetchGroup(groupId);
  const member = group.members?.[userId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const deletedSnap = await rtdb.ref(`deletedGroups/${userId}/${groupId}`).once("value");
  if (deletedSnap.exists()) {
    return [];
  }

  const clampedLimit = Math.min(Number(limit) || 20, MAX_MESSAGES_PER_PAGE);

  let query = rtdb
    .ref(`groupMessages/${groupId}`)
    .orderByKey()
    .limitToLast(clampedLimit);

  if (lastKey) {
    query = rtdb
      .ref(`groupMessages/${groupId}`)
      .orderByKey()
      .endBefore(lastKey)
      .limitToLast(clampedLimit);
  }

  const snapshot = await query.once("value");
  if (!snapshot.exists()) return [];

  const messages = [];

  snapshot.forEach((doc) => {
    const msg = doc.val();

    if (msg.deletedFor?.[userId]) return;
    if (msg.deletedForEveryone === true) return;

    messages.push(msg);
  });

  if (!lastKey) {
    await rtdb.ref(`userGroupChats/${userId}/${groupId}/unreadCount`).set(0);
  }

  return messages.reverse();
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Group Chat List for a user
// Returns all groups user is in with last message + unread count
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupChatList = async (userId) => {
  const snapshot = await rtdb
    .ref(`userGroupChats/${userId}`)
    .orderByChild("updatedAt")
    .once("value");

  if (!snapshot.exists()) return [];

  const deletedSnap = await rtdb.ref(`deletedGroups/${userId}`).once("value");
  const deletedGroupIds = deletedSnap.exists() ? Object.keys(deletedSnap.val()) : [];

  const chats = [];
  const data = snapshot.val();

  for (const groupId in data) {
    if (deletedGroupIds.includes(groupId)) continue;

    const chat = data[groupId];
    chats.push({
      groupId,
      groupName: chat.groupName || "",
      groupImage: chat.groupImage || "",
      lastMessage: chat.lastMessage || "",
      lastMessageType: chat.lastMessageType || "",
      lastMessageSender: chat.lastMessageSender || "",
      updatedAt: chat.updatedAt || 0,
      unreadCount: chat.unreadCount || 0,
    });
  }

  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return chats;
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Group Message For Me (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupMessageForMe = async (groupId, messageId, userId) => {
  // Membership check
  const group = await fetchGroup(groupId);
  const member = group.members?.[userId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const ref = rtdb.ref(`groupMessages/${groupId}/${messageId}`);
  const snap = await ref.once("value");
  if (!snap.exists()) throw new Error("Message not found");

  await ref.update({ [`deletedFor/${userId}`]: true });
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Group Message For Everyone (sender only)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupMessageForEveryone = async (groupId, messageId, userId) => {
  // Membership check
  const group = await fetchGroup(groupId);
  const member = group.members?.[userId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const ref = rtdb.ref(`groupMessages/${groupId}/${messageId}`);
  const snap = await ref.once("value");
  if (!snap.exists()) throw new Error("Message not found");

  const msg = snap.val();

  // Admins can also delete any message
  const isAdmin = !!group.admins?.[userId];
  if (msg.senderId !== userId && !isAdmin) {
    throw new Error("Only the sender or an admin can delete this message for everyone");
  }

  await ref.update({
    text: null,
    media: null,
    deletedForEveryone: true,
    deletedAt: Date.now(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Update Group Typing Status
// ─────────────────────────────────────────────────────────────────────────────
exports.updateGroupTyping = async (groupId, userId, isTyping) => {
  const group = await fetchGroup(groupId);
  const member = group.members?.[userId];
  if (!member || member.status !== "accepted") {
    throw new Error("You are not a member of this group");
  }

  const typingRef = rtdb.ref(`groupTyping/${groupId}/${userId}`);
  const current = await typingRef.once("value");

  // Avoid unnecessary writes
  if (current.exists() && current.val().isTyping === isTyping) return;

  await typingRef.set({ isTyping, updatedAt: Date.now() });
};
