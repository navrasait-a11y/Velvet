const express = require("express");
const router = express.Router();

const groupController = require("../controller/group.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { uploadGroupProfileFields, handleUploadError } = require("../middleware/upload");
const { sanitize } = require("../middleware/sanitize");
const linkFilter = require("../middleware/linkFilter");
const { auditLog } = require("../middleware/auditLog");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const {
  createGroup: createGroupValidation,
  getGroupDetails: getGroupDetailsValidation,
  acceptInvitation: acceptInvitationValidation,
  rejectInvitation: rejectInvitationValidation,
  sendGroupMessage: sendGroupMessageValidation,
  getGroupMessages: getGroupMessagesValidation,
  deleteGroupMessage: deleteGroupMessageValidation,
  updateGroupTyping: updateGroupTypingValidation,
  addMembers: addMembersValidation,
  removeMember: removeMemberValidation,
  updateShowPhoneNumbers: updateShowPhoneNumbersValidation,
  leaveGroup: leaveGroupValidation,
  deleteGroupForMe: deleteGroupForMeValidation,
  transferAdmin: transferAdminValidation,
} = require("../validations/group.validation");

// ── Static routes FIRST (before any /:groupId dynamic routes) ─────────────
router.post("/create", authMiddleware, uploadGroupProfileFields, handleUploadError, sanitize, createGroupValidation, handleValidationErrors, groupController.createGroup);
router.get("/my", authMiddleware, groupController.getMyGroups);
router.get("/chat-list", authMiddleware, groupController.getGroupChatList);
router.get("/invitations/pending", authMiddleware, groupController.getPendingInvitations);

// ── Dynamic :groupId routes ────────────────────────────────────────────────
router.get("/:groupId", authMiddleware, getGroupDetailsValidation, handleValidationErrors, groupController.getGroupDetails);

// Invitations
router.post("/:groupId/invite/accept", authMiddleware, acceptInvitationValidation, handleValidationErrors, groupController.acceptInvitation);
router.post("/:groupId/invite/reject", authMiddleware, rejectInvitationValidation, handleValidationErrors, groupController.rejectInvitation);

// Messaging
router.post("/:groupId/messages/send", authMiddleware, linkFilter, sendGroupMessageValidation, handleValidationErrors, groupController.sendGroupMessage);
router.get("/:groupId/messages", authMiddleware, getGroupMessagesValidation, handleValidationErrors, groupController.getGroupMessages);
router.put("/:groupId/messages/delete/me", authMiddleware, auditLog("delete_group_message_me"), deleteGroupMessageValidation, handleValidationErrors, groupController.deleteGroupMessageForMe);
router.put("/:groupId/messages/delete/everyone", authMiddleware, auditLog("delete_group_message_everyone"), deleteGroupMessageValidation, handleValidationErrors, groupController.deleteGroupMessageForEveryone);
router.put("/:groupId/messages/typing", authMiddleware, updateGroupTypingValidation, handleValidationErrors, groupController.updateGroupTyping);

// Admin controls
router.post("/:groupId/members/add", authMiddleware, auditLog("add_group_members"), addMembersValidation, handleValidationErrors, groupController.addMembers);
router.delete("/:groupId/members/:userId", authMiddleware, auditLog("remove_group_member"), removeMemberValidation, handleValidationErrors, groupController.removeMember);
router.patch("/:groupId/settings/phone-visibility", authMiddleware, updateShowPhoneNumbersValidation, handleValidationErrors, groupController.updateShowPhoneNumbers);
router.post("/:groupId/admin/transfer", authMiddleware, auditLog("transfer_admin"), transferAdminValidation, handleValidationErrors, groupController.transferAdmin);

// Leave
router.post("/:groupId/leave", authMiddleware, auditLog("leave_group"), leaveGroupValidation, handleValidationErrors, groupController.leaveGroup);
router.delete("/:groupId/delete/me", authMiddleware, auditLog("delete_group_for_me"), deleteGroupForMeValidation, handleValidationErrors, groupController.deleteGroupForMe);

module.exports = router;
