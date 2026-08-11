const { getRealtimeDb } = require("../config/firebase");
const { logger } = require("../utils/logger");

const rtdb = getRealtimeDb();

// ─────────────────────────────────────────────────────────────────────────────
// Create Task
// ─────────────────────────────────────────────────────────────────────────────
exports.createTask = async ({ groupId, taskData, createdBy }) => {
  const taskRef = rtdb.ref(`groupTasks/${groupId}`).push();
  const taskId = taskRef.key;
  const timestamp = Date.now();

  const task = {
    taskId,
    groupId,
    title: taskData.title || "",
    description: taskData.description || "",
    date: taskData.date || "",
    time: taskData.time || "",
    assignedTo: taskData.assignedTo || "",
    persons: taskData.persons || [],
    url: taskData.url || "",
    attachmentName: taskData.attachmentName || "",
    createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await taskRef.set(task);
  return task;
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Tasks for a Group
// ─────────────────────────────────────────────────────────────────────────────
exports.getTasks = async (groupId) => {
  const snapshot = await rtdb.ref(`groupTasks/${groupId}`).once("value");
  if (!snapshot.exists()) return [];

  const tasks = [];
  snapshot.forEach((doc) => {
    tasks.push(doc.val());
  });

  tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return tasks;
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Single Task
// ─────────────────────────────────────────────────────────────────────────────
exports.getTask = async (groupId, taskId) => {
  const snap = await rtdb.ref(`groupTasks/${groupId}/${taskId}`).once("value");
  if (!snap.exists()) throw new Error("Task not found");
  return snap.val();
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Task
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteTask = async (groupId, taskId, userId) => {
  const taskSnap = await rtdb.ref(`groupTasks/${groupId}/${taskId}`).once("value");
  if (!taskSnap.exists()) throw new Error("Task not found");

  const task = taskSnap.val();
  if (task.createdBy !== userId) {
    throw new Error("Only the task creator can delete this task");
  }

  await rtdb.ref(`groupTasks/${groupId}/${taskId}`).remove();
};
