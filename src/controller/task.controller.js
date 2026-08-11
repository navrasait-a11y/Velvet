const taskService = require("../services/task.service");
const groupService = require("../services/group.service");
const { logger } = require("../utils/logger");

// ─────────────────────────────────────────────────────────────────────────────
// Create Task
// ─────────────────────────────────────────────────────────────────────────────
exports.createTask = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId } = req.params;
    const { title, description, date, time, assignedTo, persons, url, attachmentName } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const group = await groupService.getGroupDetails(groupId, userId);

    const task = await taskService.createTask(groupId, {
      title: title.trim(),
      description: description?.trim() || "",
      date: date || "",
      time: time || "",
      assignedTo: assignedTo?.trim() || "",
      persons: Array.isArray(persons) ? persons : [],
      url: url?.trim() || "",
      attachmentName: attachmentName?.trim() || "",
    }, userId);

    return res.status(201).json({ success: true, message: "Task created", data: task });
  } catch (error) {
    logger.error("Create Task Error:", error);
    return res.status(403).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Tasks
// ─────────────────────────────────────────────────────────────────────────────
exports.getTasks = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    await groupService.getGroupDetails(groupId, userId);

    const tasks = await taskService.getTasks(groupId);

    return res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    return res.status(403).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Task
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteTask = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { groupId, taskId } = req.params;

    await groupService.getGroupDetails(groupId, userId);

    await taskService.deleteTask(groupId, taskId, userId);

    return res.status(200).json({ success: true, message: "Task deleted" });
  } catch (error) {
    return res.status(403).json({ success: false, message: error.message });
  }
};
