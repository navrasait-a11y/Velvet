const formatPhone = (raw) => {
  if (!raw) throw new Error("Phone number is required");
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }

  throw new Error("Invalid phone number format. Expected 10-digit Indian mobile number.");
};
const stripCountryCode = (phone) => {
  const formatted = formatPhone(phone);
  return formatted.slice(2); 
};

module.exports = { formatPhone, stripCountryCode };
