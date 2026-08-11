const groupService = require("../services/group.service");
const { uploadPublicImage } = require("../utils/uploads");
const { logger } = require("../utils/logger");

const getGroupErrorStatus = (error) => {
  const message = error?.message || "";
  if (message === "Group not found" || message === "No invitation found" || message === "Message not found") return 404;
  if (message === "Invitation already processed") return 409;
  if (
    message.includes("not a member") ||
    message.includes("Only admins") ||
    message.includes("Cannot remove another admin") ||
    message.includes("Only the sender") ||
    message.includes("Transfer admin role")
  ) return 403;
  if (message.includes("maximum") || message.includes("Group has reached") || message.includes("Admin cannot remove themselves")) return 400;
  return 500;
};

// ─────────────────────────────────────────────────────────────────────────────
// Create Group
// ─────────────────────────────────────────────────────────────────────────────
exports.createGroup = async (req, res) => {
  try {
    const createdBy = req.user.userId;
    const { groupName, groupBio } = req.body;

    if (!groupName || !groupName.trim()) {
      return res.status(400).json({ success: false, message: "Group name is required" });
    }

    let groupImage = "";
    if (req.files?.groupImage?.[0]) {
      groupImage = await uploadPublicImage(req.files.groupImage[0], "groupImages");
    }

    let backgroundImage = "";
    if (req.files?.backgroundImage?.[0]) {
      backgroundImage = await uploadPublicImage(req.files.backgroundImage[0], "groupBackgrounds");
    }

    let parsedMembers = [];
    if (req.body.members) {
      try {
        parsedMembers =
          typeof req.body.members === "string"
            ? JSON.parse(req.body.members)
            : req.body.members;

        if (!Array.isArray(parsedMembers)) throw new Error();
      } catch {
        return res.status(400).json({ success: false, message: "members must be a valid JSON array" });
      }
    }

    if (parsedMembers.length > 255) {
      return res.status(400).json({ success: false, message: "Maximum 255 invitees per group" });
    }

    if (parsedMembers.some((memberId) => typeof memberId !== "string" || !memberId.trim())) {
      return res.status(400).json({ success: false, message: "members must contain valid userIds" });
    }

    const group = await groupService.createGroup({
      createdBy,
      groupName: groupName.trim(),
      groupBio: groupBio || "",
      groupImage,
      backgroundImage,
      members: parsedMembers,
    });

    return res.status(201).json({ success: true, message: "Group created successfully", data: group });
  } catch (error) {
    logger.error("Create Group Error:", error);
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get My Groups
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyGroups = async (req, res) => {
  try {
    const userId = req.user.userId;
    const groups = await groupService.getMyGroups(userId);

    return res.status(200).json({ success: true, count: groups.length, data: groups });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Group Details
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupDetails = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;

    const group = await groupService.getGroupDetails(groupId, userId);

    return res.status(200).json({ success: true, data: group });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Pending Invitations
// ─────────────────────────────────────────────────────────────────────────────
exports.getPendingInvitations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const invitations = await groupService.getPendingInvitations(userId);

    return res.status(200).json({ success: true, count: invitations.length, data: invitations });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Accept Invitation
// ─────────────────────────────────────────────────────────────────────────────
exports.acceptInvitation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;

    await groupService.acceptInvitation(userId, groupId);

    return res.status(200).json({ success: true, message: "Invitation accepted" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Reject Invitation
// ─────────────────────────────────────────────────────────────────────────────
exports.rejectInvitation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;

    await groupService.rejectInvitation(userId, groupId);

    return res.status(200).json({ success: true, message: "Invitation rejected" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Add Members (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.addMembers = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { groupId } = req.params;
    const { members } = req.body;

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, message: "members array is required" });
    }
    if (members.length > 255) {
      return res.status(400).json({ success: false, message: "Maximum 255 members per request" });
    }
    if (members.some((memberId) => typeof memberId !== "string" || !memberId.trim())) {
      return res.status(400).json({ success: false, message: "members must contain valid userIds" });
    }

    const result = await groupService.addMembers(adminId, groupId, members);

    return res.status(200).json({
      success: true,
      message: "Members processed",
      data: result,
    });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Remove Member (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.removeMember = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { groupId, userId } = req.params;

    await groupService.removeMember(adminId, groupId, userId);

    return res.status(200).json({ success: true, message: "Member removed successfully" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Update showPhoneNumbers setting (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateShowPhoneNumbers = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { groupId } = req.params;
    const { showPhoneNumbers } = req.body;

    if (typeof showPhoneNumbers !== "boolean") {
      return res.status(400).json({ success: false, message: "showPhoneNumbers must be a boolean" });
    }

    await groupService.updateShowPhoneNumbers(adminId, groupId, showPhoneNumbers);

    return res.status(200).json({
      success: true,
      message: `Phone numbers are now ${showPhoneNumbers ? "visible" : "hidden"} to members`,
    });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Leave Group
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;

    await groupService.leaveGroup(userId, groupId);

    return res.status(200).json({ success: true, message: "You have left the group" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Group For Me — leaves group and hides all old messages
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupForMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;

    await groupService.deleteGroupForMe(userId, groupId);

    return res.status(200).json({ success: true, message: "Group deleted for you" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Group Message
// ─────────────────────────────────────────────────────────────────────────────
exports.sendGroupMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { groupId } = req.params;
    const { message, type = "text" } = req.body;

    if (type !== "text") {
      return res.status(400).json({
        success: false,
        message: "Only text messages are supported in groups (MVP)",
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }

    const data = await groupService.sendGroupMessage({
      groupId,
      senderId,
      message: message.trim(),
      type,
    });

    return res.status(201).json({ success: true, message: "Message sent", data });
  } catch (error) {
    logger.error("Send Group Message Error:", error);
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Group Messages
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;
    const { limit = 20, lastKey } = req.query;

    const messages = await groupService.getGroupMessages(groupId, userId, limit, lastKey);

    return res.status(200).json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    logger.error("Get Group Messages Error:", error);
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Group Chat List
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupChatList = async (req, res) => {
  try {
    const userId = req.user.userId;
    const chats = await groupService.getGroupChatList(userId);

    return res.status(200).json({ success: true, count: chats.length, data: chats });
  } catch (error) {
    logger.error("Get Group Chat List Error:", error);
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Group Message For Me
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupMessageForMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ success: false, message: "messageId is required" });
    }

    await groupService.deleteGroupMessageForMe(groupId, messageId, userId);

    return res.status(200).json({ success: true, message: "Message deleted for you" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Group Message For Everyone
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroupMessageForEveryone = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ success: false, message: "messageId is required" });
    }

    await groupService.deleteGroupMessageForEveryone(groupId, messageId, userId);

    return res.status(200).json({ success: true, message: "Message deleted for everyone" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Update Group Typing Status
// ─────────────────────────────────────────────────────────────────────────────
exports.updateGroupTyping = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;
    const { isTyping } = req.body;

    if (typeof isTyping !== "boolean") {
      return res.status(400).json({ success: false, message: "isTyping must be a boolean" });
    }

    await groupService.updateGroupTyping(groupId, userId, isTyping);

    return res.status(200).json({ success: true, message: "Typing status updated" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Admin Role
// ─────────────────────────────────────────────────────────────────────────────
exports.transferAdmin = async (req, res) => {
  try {
    const currentAdminId = req.user.userId;
    const { groupId } = req.params;
    const { newAdminId } = req.body;

    if (!newAdminId || typeof newAdminId !== "string") {
      return res.status(400).json({ success: false, message: "newAdminId is required" });
    }

    await groupService.transferAdmin(currentAdminId, groupId, newAdminId);

    return res.status(200).json({ success: true, message: "Admin role transferred successfully" });
  } catch (error) {
    return res.status(getGroupErrorStatus(error)).json({ success: false, message: error.message });
  }
};
