const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const collections = new Map();
const getCollection = (name) => {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name);
};
const users = getCollection("users");
const sentNotifications = [];

const makeDocumentReference = (collectionName, id) => ({
  id,
  get: async () => {
    const data = getCollection(collectionName).get(id);
    return { id, exists: data !== undefined, data: () => data };
  },
  set: async (data, options = {}) => {
    const collection = getCollection(collectionName);
    collection.set(id, options.merge ? { ...collection.get(id), ...data } : data);
  },
  update: async (data) => {
    const collection = getCollection(collectionName);
    if (!collection.has(id)) throw new Error("Document does not exist");
    collection.set(id, { ...collection.get(id), ...data });
  },
  collectionName,
});

const firestore = () => ({});
firestore.FieldPath = { documentId: () => "__name__" };
firestore.FieldValue = { delete: () => null };

const fakeDb = {
  collection: (collectionName) => ({
    doc: (id) => makeDocumentReference(collectionName, id),
    where: (field, operator, values) => ({
      where() {
        return this;
      },
      get: async () => {
        const collection = getCollection(collectionName);
        const ids = field === "__name__" && operator === "in"
          ? values
          : [...collection.keys()];
        const docs = ids
          .filter((id) => {
            const data = collection.get(id);
            return data && (
              field === "__name__" && operator === "in"
                ? true
                : operator === "==" && data[field] === values
            );
          })
          .map((id) => ({ id, data: () => collection.get(id) }));
        return {
          docs,
          empty: docs.length === 0,
          forEach: (callback) => docs.forEach(callback),
        };
      },
      limit() {
        return this;
      },
    }),
  }),
  runTransaction: async (callback) => {
    const writes = [];
    const result = await callback({
      get: async (reference) => reference.get(),
      set: (reference, data) => writes.push([reference, data]),
    });
    for (const [reference, data] of writes) await reference.set(data);
    return result;
  },
};

const fakeFirebaseConfig = new Module(
  path.resolve(__dirname, "../config/firebase.js"),
  module
);
fakeFirebaseConfig.exports = {
  admin: {
    firestore,
    messaging: () => ({
      send: async (payload) => {
        sentNotifications.push(payload);
        return "sent";
      },
      sendEachForMulticast: async (payload) => {
        sentNotifications.push(payload);
        return { responses: payload.tokens.map(() => ({ success: true })) };
      },
    }),
  },
  getDb: () => fakeDb,
  getRealtimeDb: () => ({ ref: () => ({ once: async () => ({ exists: () => false }) }) }),
  getBucket: () => ({ file: () => ({}) }),
  getTimestamp: () => "test-timestamp",
};
require.cache[require.resolve("../config/firebase")] = fakeFirebaseConfig;

process.env.JWT_SECRET = "notification-preferences-test-secret";
process.env.NODE_ENV = "test";

const app = require("../app");
const notificationService = require("../services/notification.service");
const { findOrCreateUser } = require("../services/user.service");
const server = http.createServer(app);

const request = (method, endpoint, { userId, body, token = true } = {}) =>
  fetch(`http://127.0.0.1:${server.address().port}/api/user${endpoint}`, {
    method,
    headers: {
      ...(token ? {
        Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
      } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("notification preferences default on, persist per user, and require authentication", async (t) => {
  users.set("owner-user", { userId: "owner-user", phone: "919876543210", fcmToken: "owner-token" });
  users.set("other-user", { userId: "other-user", phone: "919876543211", fcmToken: "other-token" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const defaultResponse = await request("GET", "/notification-preferences", { userId: "owner-user" });
  assert.equal(defaultResponse.status, 200);
  assert.deepEqual((await defaultResponse.json()).data, { pushNotificationsEnabled: true });

  const invalidResponse = await request("PATCH", "/notification-preferences", {
    userId: "owner-user",
    body: { pushNotificationsEnabled: "false" },
  });
  assert.equal(invalidResponse.status, 400);

  const updateResponse = await request("PATCH", "/notification-preferences", {
    userId: "owner-user",
    body: { pushNotificationsEnabled: false },
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual((await updateResponse.json()).data, { pushNotificationsEnabled: false });

  const ownerData = (await fakeDb.collection("users").doc("owner-user").get()).data();
  const otherData = (await fakeDb.collection("users").doc("other-user").get()).data();
  assert.equal(ownerData.pushNotificationsEnabled, false);
  assert.equal(otherData.pushNotificationsEnabled, undefined);

  const enableResponse = await request("PATCH", "/notification-preferences", {
    userId: "owner-user",
    body: { pushNotificationsEnabled: true },
  });
  assert.equal(enableResponse.status, 200);
  assert.equal(
    (await fakeDb.collection("users").doc("owner-user").get()).data().pushNotificationsEnabled,
    true
  );

  const unauthorizedResponse = await request("GET", "/notification-preferences", { token: false });
  assert.equal(unauthorizedResponse.status, 401);
});

test("new accounts default to push notifications enabled", async () => {
  const { userId } = await findOrCreateUser("919876543212");
  const user = (await fakeDb.collection("users").doc(userId).get()).data();
  assert.equal(user.pushNotificationsEnabled, true);
});

test("push dispatch honors preferences and leaves legacy accounts enabled", async () => {
  users.set("disabled-user", {
    userId: "disabled-user",
    fcmToken: "disabled-token",
    pushNotificationsEnabled: false,
  });
  users.set("enabled-user", { userId: "enabled-user", fcmToken: "enabled-token" });
  sentNotifications.length = 0;

  await notificationService.notifyNewMessage({
    receiverId: "disabled-user",
    senderId: "sender-user",
    senderName: "Sender",
    message: "Hello",
    type: "text",
    roomId: "room-id",
  });
  assert.equal(sentNotifications.length, 0);

  await notificationService.notifyNewMessage({
    receiverId: "enabled-user",
    senderId: "sender-user",
    senderName: "Sender",
    message: "Hello",
    type: "text",
    roomId: "room-id",
  });
  assert.equal(sentNotifications.length, 1);
  assert.equal(sentNotifications[0].token, "enabled-token");

  await notificationService.notifyNewGroupMessage({
    groupId: "group-id",
    groupName: "Group",
    senderName: "Sender",
    message: "Hello",
    type: "text",
    memberIds: ["disabled-user", "enabled-user"],
  });
  assert.deepEqual(sentNotifications[1].tokens, ["enabled-token"]);
});
