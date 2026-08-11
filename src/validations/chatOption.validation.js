const { param } = require("express-validator");

const validateRoomId = param("roomId")
  .isString()
  .isLength({ min: 5, max: 100 })
  .withMessage("Invalid roomId");

module.exports = {
  validateRoomId,
};
