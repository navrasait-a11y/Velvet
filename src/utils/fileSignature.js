const FILE_SIGNATURES = {
  image: {
    "image/jpeg": { offsets: [{ pos: 0, bytes: [0xFF, 0xD8, 0xFF] }] },
    "image/png":  { offsets: [{ pos: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }] },
    "image/gif":  { offsets: [{ pos: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, { pos: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }] },
    "image/webp": { offsets: [{ pos: 8, bytes: [0x57, 0x45, 0x42, 0x50] }] },
  },
  video: {
    "video/mp4":  { offsets: [{ pos: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D] }] },
    "video/webm": { offsets: [{ pos: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }] },
    "video/ogg":  { offsets: [{ pos: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }] },
  },
  audio: {
    "audio/mpeg": { offsets: [{ pos: 0, bytes: [0xFF, 0xFB] }, { pos: 0, bytes: [0xFF, 0xF3] }, { pos: 0, bytes: [0xFF, 0xF2] }] },
    "audio/mp4":  { offsets: [{ pos: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41] }] },
    "audio/ogg":  { offsets: [{ pos: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }] },
    "audio/wav":  { offsets: [{ pos: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { pos: 8, bytes: [0x57, 0x41, 0x56, 0x45] }] },
    "audio/webm": { offsets: [{ pos: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }] },
  },
  document: {
    "application/pdf":               { offsets: [{ pos: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
    "application/msword":            { offsets: [{ pos: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }] },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { offsets: [{ pos: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }] },
    "application/vnd.ms-excel":      { offsets: [{ pos: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }] },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { offsets: [{ pos: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }] },
    "text/plain":                    null, // No reliable magic number
    "text/csv":                      null, // No reliable magic number
  },
};

const matchesSignature = (buffer, mimeType) => {
  const signatures = FILE_SIGNATURES.image?.[mimeType]
    || FILE_SIGNATURES.video?.[mimeType]
    || FILE_SIGNATURES.audio?.[mimeType]
    || FILE_SIGNATURES.document?.[mimeType];

  if (!signatures) return true;

  for (const { pos, bytes } of signatures.offsets) {
    if (pos + bytes.length > buffer.length) continue;
    const slice = buffer.slice(pos, pos + bytes.length);
    if (Buffer.compare(slice, Buffer.from(bytes)) === 0) {
      return true;
    }
  }
  return false;
};

const detectMimeType = (buffer) => {
  if (!buffer || buffer.length === 0) return null;

  const allSignatures = [
    ...Object.entries(FILE_SIGNATURES.image || {}),
    ...Object.entries(FILE_SIGNATURES.video || {}),
    ...Object.entries(FILE_SIGNATURES.audio || {}),
    ...Object.entries(FILE_SIGNATURES.document || {}),
  ];

  for (const [mimeType, signatures] of allSignatures) {
    if (signatures === null) continue;
    for (const { pos, bytes } of signatures.offsets) {
      if (pos + bytes.length > buffer.length) continue;
      const slice = buffer.slice(pos, pos + bytes.length);
      if (Buffer.compare(slice, Buffer.from(bytes)) === 0) {
        return mimeType;
      }
    }
  }
  return null;
};

const verifyFileContent = (file, mimeType) => {
  if (!file?.buffer) return false;
  return matchesSignature(file.buffer, mimeType);
};

module.exports = { verifyFileContent, detectMimeType };
