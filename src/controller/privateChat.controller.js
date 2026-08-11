const privateChatService = require("../services/privateChat.service");

const MAX_PASSWORD_LENGTH = 64;

const validatePassword = (password, res) => {
  if (!password || typeof password !== "string") {
    res.status(400).json({ success: false, message: "Password is required" });
    return false;
  }
  if (password.length < 8) {
    res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    return false;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    res.status(400).json({ success: false, message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` });
    return false;
  }
  return true;
};

// Setup Private Chat Password
exports.setupPrivateChat = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!validatePassword(password, res)) return;

    await privateChatService.setupPrivateChat(userId, password);
    return res.status(200).json({ success: true, message: "Private chat password created successfully" });
  } catch (error) {
    const status = error.message === "Private chat password already exists" ? 409 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// Verify Password
exports.verifyPrivateChat = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    await privateChatService.verifyPrivateChat(userId, password);

    return res.status(200).json({ success: true, verified: true, message: "Password verified successfully" });
  } catch (error) {
    // Only return 401 for actual auth failures, not for server errors
    if (error.message === "Invalid password" || error.message === "Private chat is not enabled") {
      return res.status(401).json({ success: false, verified: false, message: error.message });
    }
    return res.status(500).json({ success: false, verified: false, message: "Verification failed" });
  }
};

// Change Password
exports.changePrivateChatPassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword) {
      return res.status(400).json({ success: false, message: "oldPassword is required" });
    }
    if (!validatePassword(newPassword, res)) return;
    if (oldPassword === newPassword) {
      return res.status(400).json({ success: false, message: "New password must be different from old password" });
    }

    await privateChatService.changePrivateChatPassword(userId, oldPassword, newPassword);
    return res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    if (error.message === "Old password is incorrect" || error.message === "Private chat is not enabled") {
      return res.status(401).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Failed to change password" });
  }
};

// Remove Password
exports.removePrivateChatPassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    await privateChatService.removePrivateChatPassword(userId, password);
    return res.status(200).json({ success: true, message: "Private chat disabled successfully" });
  } catch (error) {
    if (error.message === "Invalid password" || error.message === "Private chat is not enabled") {
      return res.status(401).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Failed to remove password" });
  }
};

// Get Status
exports.getPrivateChatStatus = async (req, res) => {
  try {
    const userId = req.user.userId;
    const status = await privateChatService.getPrivateChatStatus(userId);
    return res.status(200).json({ success: true, enabled: status });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to get status" });
  }
};
