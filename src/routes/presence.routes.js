const express = require("express");
const router = express.Router();
const presenceController = require("../controller/presence.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { handleValidationErrors } = require("../middleware/handleValidationErrors");
const { batchPresence, getPresence } = require("../validations/presence.validation");

// Static routes MUST be before dynamic /:userId to avoid route conflicts
router.post("/offline", authMiddleware, presenceController.setOffline);
router.post("/batch", authMiddleware, batchPresence, handleValidationErrors, presenceController.getBatchPresence);

// Dynamic — must be last
router.get("/:userId", authMiddleware, getPresence, handleValidationErrors, presenceController.getPresence);

module.exports = router;
