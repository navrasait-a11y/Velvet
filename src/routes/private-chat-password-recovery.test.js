const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const documents = new Map();
const makeDocumentReference = (collectionName, id) => {
  const key = `${collectionName}/${id}`;
  return {
    get: async () => {
      const data = documents.get(key);
      return { exists: data !== undefined, data: () => data };
    },
    set: async (data, options = {}) => {
      documents.set(key, options.merge ? { ...documents.get(key), ...data } : data);
    },
    update: async (data) => {
      if (!documents.has(key)) throw new Error("Document does not exist");
      documents.set(key, { ...documents.get(key), ...data });
    },
    delete: async () => documents.delete(key),
  };
};

const fakeDb = {
  collection: (collectionName) => ({
    doc: (id) => makeDocumentReference(collectionName, id),
  }),
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

process.env.JWT_SECRET = "private-chat-recovery-test-secret";
process.env.NODE_ENV = "test";
process.env.TEST_OTP = "1234";

const app = require("../app");
const server = http.createServer(app);
const userId = "private-chat-owner";

const request = (method, endpoint, { body, authenticated = true } = {}) =>
  fetch(`http://127.0.0.1:${server.address().port}/api/privateChat${endpoint}`, {
    method,
    headers: {
      ...(authenticated
        ? { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("private-chat password change and OTP recovery are distinct and authenticated", async (t) => {
  const initialHash = await bcrypt.hash("current-password", 4);
  documents.set(`users/${userId}`, { userId, phone: "919876543210" });
  documents.set(`Users_Private_Settings/${userId}`, { enabled: true, password: initialHash });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    delete process.env.TEST_OTP;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const unauthorizedResponse = await request("POST", "/password/recover", {
    authenticated: false,
    body: { sessionId: "test-session", otp: "1234", newPassword: "recovered-password" },
  });
  assert.equal(unauthorizedResponse.status, 401);

  const invalidResponse = await request("POST", "/password/recover", {
    body: { sessionId: "test-session", otp: "12", newPassword: "recovered-password" },
  });
  assert.equal(invalidResponse.status, 400);

  const incorrectCurrentResponse = await request("PATCH", "/password", {
    body: { oldPassword: "incorrect-password", newPassword: "changed-password" },
  });
  assert.equal(incorrectCurrentResponse.status, 401);

  const changeResponse = await request("PATCH", "/password", {
    body: { oldPassword: "current-password", newPassword: "changed-password" },
  });
  assert.equal(changeResponse.status, 200);
  const changedHash = documents.get(`Users_Private_Settings/${userId}`).password;
  assert.equal(await bcrypt.compare("changed-password", changedHash), true);

  const recoveryFailureResponse = await request("POST", "/password/recover", {
    body: { sessionId: "expired-session", otp: "0000", newPassword: "recovered-password" },
  });
  assert.equal(recoveryFailureResponse.status, 401);
  assert.equal(documents.get(`Users_Private_Settings/${userId}`).password, changedHash);

  const recoveryResponse = await request("POST", "/password/recover", {
    body: { sessionId: "verified-otp-session", otp: "1234", newPassword: "recovered-password" },
  });
  assert.equal(recoveryResponse.status, 200);
  const recoveredHash = documents.get(`Users_Private_Settings/${userId}`).password;
  assert.equal(await bcrypt.compare("recovered-password", recoveredHash), true);
  assert.equal(await bcrypt.compare("changed-password", recoveredHash), false);
});
