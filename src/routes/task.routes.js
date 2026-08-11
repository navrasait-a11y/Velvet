const express = require("express");
const router = express.Router();

const taskController = require("../controller/task.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { sanitize } = require("../middleware/sanitize");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const {
  createTask: createTaskValidation,
  getTasks: getTasksValidation,
  deleteTask: deleteTaskValidation,
} = require("../validations/task.validation");

router.post("/:groupId/tasks", authMiddleware, sanitize, createTaskValidation, handleValidationErrors, taskController.createTask);
router.get("/:groupId/tasks", authMiddleware, getTasksValidation, handleValidationErrors, taskController.getTasks);
router.delete("/:groupId/tasks/:taskId", authMiddleware, deleteTaskValidation, handleValidationErrors, taskController.deleteTask);

module.exports = router;
