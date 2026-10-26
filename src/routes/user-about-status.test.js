const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const documents = new Map();
const documentReference = (documentPath) => ({
  id: documentPath.split("/").pop(),
  get: async () => {
    const data = documents.get(documentPath);
    return { id: documentPath.split("/").pop(), exists: data !== undefined, data: () => data };
  },
  set: async (data, options = {}) => {
    documents.set(
      documentPath,
      options.merge ? { ...documents.get(documentPath), ...data } : data
    );
  },
  update: async (data) => {
    if (!documents.has(documentPath)) throw new Error("Document does not exist");
    documents.set(documentPath, { ...documents.get(documentPath), ...data });
  },
});

const fakeDb = {
  collection: (name) => ({
    doc: (id) => {
      const documentPath = `${name}/${id}`;
      const reference = documentReference(documentPath);
      reference.collection = (subcollection) => ({
        doc: (childId) => documentReference(`${documentPath}/${subcollection}/${childId}`),
      });
      return reference;
    },
  }),
  getAll: async (...references) => Promise.all(references.map((reference) => reference.get())),
};
const firestore = () => ({});
firestore.FieldValue = { delete: () => null };

const fakeFirebaseConfig = new Module(
  path.resolve(__dirname, "../config/firebase.js"),
  module
);
fakeFirebaseConfig.exports = {
  admin: { firestore },
  getDb: () => fakeDb,
  getRealtimeDb: () => ({ ref: () => ({}) }),
  getBucket: () => ({ file: () => ({}) }),
};
require.cache[require.resolve("../config/firebase")] = fakeFirebaseConfig;

process.env.JWT_SECRET = "about-status-test-secret";
process.env.NODE_ENV = "test";

const app = require("../app");
const server = http.createServer(app);
const ownerId = "about-owner-100";
const contactId = "about-contact-200";
const excludedId = "about-excluded-300";
const strangerId = "about-stranger-400";

const request = (method, endpoint, { userId = ownerId, body } = {}) =>
  fetch(`http://127.0.0.1:${server.address().port}/api/user${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const publicProfile = async (viewerId) => {
  const response = await request("GET", `/profile/${ownerId}`, { userId: viewerId });
  assert.equal(response.status, 200);
  return (await response.json()).data;
};

test("About status validates emoji, expires, and enforces all visibility modes", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  documents.set(`Users_Profile/${ownerId}`, {
    userId: ownerId,
    name: "Owner",
    bio: "Freeform status remains supported",
    aboutStatus: "👨‍👩‍👧‍👦 🇺🇸",
    aboutVisibility: "everyone",
    aboutExcludedContacts: [],
    aboutExpiresAt: null,
  });
  documents.set(`User_Contacts/${ownerId}/contacts/${contactId}`, { savedAt: Date.now() });
  documents.set(`User_Contacts/${ownerId}/contacts/${excludedId}`, { savedAt: Date.now() });
  documents.set(`users/${ownerId}`, { phone: "919876543210" });

  const invalidEmojiResponse = await request("PATCH", "/update", {
    body: { bio: "Still freeform", aboutStatus: "Hello 😀" },
  });
  assert.equal(invalidEmojiResponse.status, 400);

  const freeformBioResponse = await request("PATCH", "/update", {
    body: { bio: "Freeform bio", aboutStatus: "❤️ 1️⃣" },
  });
  assert.equal(freeformBioResponse.status, 200);
  assert.equal((await freeformBioResponse.json()).data.bio, "Freeform bio");

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const contactsExceptResponse = await request("PATCH", "/update", {
    body: {
      aboutStatus: "👨‍👩‍👧‍👦 🇺🇸",
      aboutVisibility: "contacts_except",
      aboutExcludedContacts: [excludedId, excludedId],
      aboutExpiresAt: futureExpiry,
    },
  });
  assert.equal(contactsExceptResponse.status, 200);
  const ownerProfileResponse = await request("GET", "/me");
  const ownerProfile = (await ownerProfileResponse.json()).data;
  assert.deepEqual(ownerProfile.aboutExcludedContacts, [excludedId]);
  assert.equal(ownerProfile.aboutExpiresAt, Date.parse(futureExpiry));
  assert.equal(ownerProfile.bio, "Freeform bio");

  assert.equal((await publicProfile(contactId)).aboutStatus, "👨‍👩‍👧‍👦 🇺🇸");
  assert.equal(Object.hasOwn(await publicProfile(excludedId), "aboutStatus"), false);
  assert.equal(Object.hasOwn(await publicProfile(strangerId), "aboutStatus"), false);

  const contactsResponse = await request("PATCH", "/update", {
    body: { aboutVisibility: "contacts", aboutExcludedContacts: "[]" },
  });
  assert.equal(contactsResponse.status, 200);
  assert.equal((await publicProfile(contactId)).aboutStatus, "👨‍👩‍👧‍👦 🇺🇸");
  assert.equal(Object.hasOwn(await publicProfile(strangerId), "aboutStatus"), false);

  for (const visibility of ["everyone", "nobody"]) {
    const updateResponse = await request("PATCH", "/update", {
      body: { aboutVisibility: visibility },
    });
    assert.equal(updateResponse.status, 200);
    const result = await publicProfile(strangerId);
    assert.equal(Object.hasOwn(result, "aboutStatus"), visibility === "everyone");
  }

  const invalidExcludedResponse = await request("PATCH", "/update", {
    body: {
      aboutVisibility: "contacts_except",
      aboutExcludedContacts: [strangerId],
    },
  });
  assert.equal(invalidExcludedResponse.status, 400);

  const invalidVisibilityResponse = await request("PATCH", "/update", {
    body: { aboutVisibility: "friends" },
  });
  assert.equal(invalidVisibilityResponse.status, 400);

  const invalidExpiryResponse = await request("PATCH", "/update", {
    body: { aboutExpiresAt: "2026-01-01T00:00:00Z" },
  });
  assert.equal(invalidExpiryResponse.status, 400);

  const expiryUpdate = await request("PATCH", "/update", {
    body: { aboutExpiresAt: new Date(Date.now() - 60_000).toISOString() },
  });
  assert.equal(expiryUpdate.status, 400);

  documents.set(`Users_Profile/${ownerId}`, {
    ...documents.get(`Users_Profile/${ownerId}`),
    aboutExpiresAt: Date.now() - 1,
  });
  assert.equal(Object.hasOwn(await publicProfile(contactId), "aboutStatus"), false);
  assert.equal((await (await request("GET", "/me")).json()).data.aboutStatus, "");

  const newOwnerId = "about-new-owner-500";
  documents.set(
    `User_Contacts/${newOwnerId}/contacts/${contactId}`,
    { savedAt: Date.now() }
  );
  const createResponse = await request("POST", "/create", {
    userId: newOwnerId,
    body: {
      name: "New Owner",
      bio: "Freeform About remains unchanged",
    },
  });
  assert.equal(createResponse.status, 201);
  const createdProfile = (await createResponse.json()).data;
  assert.equal(createdProfile.bio, "Freeform About remains unchanged");
  assert.equal(createdProfile.aboutStatus, "");
  assert.equal(createdProfile.aboutVisibility, "everyone");
  assert.deepEqual(createdProfile.aboutExcludedContacts, []);
  assert.equal(createdProfile.aboutExpiresAt, null);

  const updateCreatedProfile = await request("PATCH", "/update", {
    userId: newOwnerId,
    body: {
      aboutStatus: "🌱",
      aboutVisibility: "contacts_except",
      aboutExcludedContacts: JSON.stringify([contactId]),
    },
  });
  assert.equal(updateCreatedProfile.status, 200);
  const updatedCreatedProfile = (await updateCreatedProfile.json()).data;
  assert.equal(updatedCreatedProfile.aboutVisibility, "contacts_except");
  assert.deepEqual(updatedCreatedProfile.aboutExcludedContacts, [contactId]);
});
