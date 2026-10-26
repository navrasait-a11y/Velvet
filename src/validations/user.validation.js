const { body } = require("express-validator");
const { isEmojiOnlyAbout } = require("../utils/aboutStatus");

const ABOUT_VISIBILITIES = ["everyone", "contacts", "contacts_except", "nobody"];

const isExcludedContactsArray = (value) => {
  let contacts = value;
  if (typeof contacts === "string") {
    try {
      contacts = JSON.parse(contacts);
    } catch {
      return false;
    }
  }
  return Array.isArray(contacts) &&
    contacts.length <= 100 &&
    contacts.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 100);
};

const validateAboutFields = () => [
  body("aboutStatus")
    .optional()
    .isString()
    .isLength({ max: 100 })
    .bail()
    .custom(isEmojiOnlyAbout)
    .withMessage("aboutStatus must contain only emoji"),
  body("aboutVisibility")
    .optional()
    .isString()
    .isIn(ABOUT_VISIBILITIES)
    .withMessage(`aboutVisibility must be one of: ${ABOUT_VISIBILITIES.join(", ")}`),
  body("aboutExcludedContacts")
    .optional()
    .custom(isExcludedContactsArray)
    .withMessage("aboutExcludedContacts must be an array of up to 100 user IDs"),
  body("aboutExpiresAt")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .isISO8601({ strict: true, strictSeparator: true })
    .bail()
    .custom((value) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    .withMessage("aboutExpiresAt must be a timezone-qualified ISO 8601 datetime"),
];

const createProfile = [
  body("name")
    .isString()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be 2-50 characters"),
  ...validateAboutFields(),
];

const updateProfile = [
  body("name")
    .optional()
    .isString()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be 2-50 characters"),
  body("bio")
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage("Bio max 200 characters"),
  ...validateAboutFields(),
];

const checkContact = [
  body("contacts")
    .isArray({ max: 1000 })
    .withMessage("contacts must be an array (max 1000)"),
];

const updateNotificationPreferences = [
  body("pushNotificationsEnabled")
    .isBoolean({ strict: true })
    .withMessage("pushNotificationsEnabled must be a boolean"),
];

module.exports = {
  createProfile,
  updateProfile,
  checkContact,
  updateNotificationPreferences,
  ABOUT_VISIBILITIES,
};
