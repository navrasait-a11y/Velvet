const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const database = {};
const storedFiles = new Map();
const transactionNullOnce = new Set();
let nextMessageId = 0;

const getAt = (pathName) =>
  pathName.split("/").filter(Boolean).reduce((value, key) => value?.[key], database);

const setAt = (pathName, value) => {
  const keys = pathName.split("/").filter(Boolean);
  const lastKey = keys.pop();
  const parent = keys.reduce((current, key) => {
    current[key] ||= {};
    return current[key];
  }, database);
  if (value === null) delete parent[lastKey];
  else parent[lastKey] = value;
};

class Snapshot {
  constructor(value, key) {
    this.value = value;
    this.key = key;
  }

  exists() {
    return this.value !== undefined && this.value !== null;
  }

  val() {
    return this.value;
  }

  forEach(callback) {
    Object.entries(this.value || {}).forEach(([key, value]) => callback(new Snapshot(value, key)));
  }
}

const fakeRealtimeDb = {
  ref(pathName = "") {
    return {
      once: async () => new Snapshot(getAt(pathName), pathName.split("/").pop()),
      set: async (value) => setAt(pathName, value),
      update: async (values) => {
        for (const [key, value] of Object.entries(values)) {
          setAt([pathName, key].filter(Boolean).join("/"), value);
        }
      },
      push: () => ({ key: `test-message-${++nextMessageId}` }),
      transaction: async (update) => {
        const current = getAt(pathName) ?? null;
        let localValue = current;
        if (transactionNullOnce.has(pathName)) {
          transactionNullOnce.delete(pathName);
          localValue = null;
        }
        let next = update(localValue);
        if (localValue === null && current !== null && next === null) {
          next = update(current);
        }
        if (next === undefined) return { committed: false, snapshot: new Snapshot(current) };
        setAt(pathName, next);
        return { committed: true, snapshot: new Snapshot(next) };
      },
    };
  },
};

const fakeBucket = {
  name: "reminder-test-bucket",
  file(storagePath) {
    return {
      save: async (buffer, options) => storedFiles.set(storagePath, { buffer, options }),
      getSignedUrl: async () => [`https://storage.test/${storagePath}`],
      delete: async () => storedFiles.delete(storagePath),
    };
  },
};

const firebaseConfigPath = path.resolve(__dirname, "../config/firebase.js");
const fakeFirebaseConfig = new Module(firebaseConfigPath, module);
fakeFirebaseConfig.exports = {
  getRealtimeDb: () => fakeRealtimeDb,
  getDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    }),
  }),
  getBucket: () => fakeBucket,
};
require.cache[firebaseConfigPath] = fakeFirebaseConfig;

process.env.JWT_SECRET = "reminder-test-secret";
process.env.NODE_ENV = "test";

const app = require("../app");
const { deliverReminder } = require("../utils/reminderScheduler");

const server = http.createServer(app);
const userId = "test-user-100";
const receiverId = "other-user-200";
const roomId = [userId, receiverId].sort().join("_");
setAt(`chatRooms/${roomId}`, { participants: { [userId]: true, [receiverId]: true } });

const request = async (method, endpoint, { token = userId, body } = {}) => {
  const isMultipart = body instanceof FormData;
  return fetch(`http://127.0.0.1:${server.address().port}/api/reminders${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt.sign({ userId: token }, process.env.JWT_SECRET)}`,
      ...(!isMultipart ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined || isMultipart ? body : JSON.stringify(body),
  });
};

const reminderFields = (scheduledAt) => ({
  message: "Reminder message",
  targetType: "private_chat",
  targetId: receiverId,
  receiverId,
  scheduledAt,
  mentions: [],
});

const formWithReminder = (fields, file) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  if (file) {
    form.append("file", new Blob([file.contents], { type: file.type }), file.name);
  }
  return form;
};

test("Reminder API handles multipart create/update, scheduling, and cancellation lifecycle", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  let noFileReminderId;
  await t.test("create without a file, retrieve by the returned ID, and reject past dates", async () => {
    const response = await request("POST", "", {
      body: reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.status, "pending");
    assert.equal(payload.data.attachment, null);
    noFileReminderId = payload.data.reminderId;

    const getResponse = await request("GET", `/${noFileReminderId}`);
    const getPayload = await getResponse.json();
    assert.equal(getResponse.status, 200);
    assert.equal(getPayload.data.reminderId, noFileReminderId);

    const pastResponse = await request("POST", "", {
      body: reminderFields(new Date(Date.now() - 60 * 1000).toISOString()),
    });
    const pastPayload = await pastResponse.json();
    assert.equal(pastResponse.status, 400);
    assert.match(pastPayload.message, /future/i);

    const timezoneLessResponse = await request("POST", "", {
      body: reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/Z$/, "")),
    });
    assert.equal(timezoneLessResponse.status, 400);

    const missingReceiverFields = reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    delete missingReceiverFields.receiverId;
    const missingReceiverResponse = await request("POST", "", { body: missingReceiverFields });
    assert.equal(missingReceiverResponse.status, 400);
  });

  let reminderId;
  await t.test("receive and store a multipart file with the reminder", async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await request("POST", "", {
      body: formWithReminder(reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString()), {
        name: "reminder.png",
        type: "image/png",
        contents: imageBytes,
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.attachment.fileType, "image");
    assert.equal(payload.data.attachment.mimeType, "image/png");
    assert.match(payload.data.attachment.url, /^https:\/\/storage\.test\//);
    assert.deepEqual(storedFiles.get(payload.data.attachment.storagePath).buffer, imageBytes);
    assert.equal(getAt(`reminders/${payload.data.reminderId}`).attachment.storagePath, payload.data.attachment.storagePath);
    const listResponse = await request("GET", "");
    const listPayload = await listResponse.json();
    const listedReminder = listPayload.data.find((reminder) => reminder.reminderId === payload.data.reminderId);
    assert.ok(listedReminder);
    reminderId = listedReminder.reminderId;
  });

  await t.test("deliver Reminder text and uploaded attachment to the private chat", async () => {
    const reminder = getAt(`reminders/${reminderId}`);
    await deliverReminder(reminder);

    const messages = getAt(`messages/${roomId}`);
    const delivered = Object.values(messages);
    const reminderText = delivered.find(
      (message) => message.type === "text" && message.text === reminder.message
    );
    const attachmentMessage = delivered.find(
      (message) => message.type === reminder.attachment.fileType
    );

    assert.ok(reminderText);
    assert.ok(attachmentMessage);
    assert.deepEqual(attachmentMessage.media, {
      ...reminder.attachment,
      url: `https://storage.test/${reminder.attachment.storagePath}`,
    });
    assert.equal(attachmentMessage.senderId, userId);
    assert.equal(attachmentMessage.receiverId, receiverId);
  });

  await t.test("reject file content that does not match its declared type", async () => {
    const response = await request("POST", "", {
      body: formWithReminder(reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString()), {
        name: "attachment.pdf",
        type: "application/pdf",
        contents: "not a PDF",
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.message, /content does not match/i);
  });

  await t.test("edit fields partially, reject past edit times, and replace attachments", async () => {
    const original = getAt(`reminders/${reminderId}`);
    const unauthorizedResponse = await request("PUT", `/${reminderId}`, {
      token: "different-user-300",
      body: { message: "Unauthorized edit" },
    });
    assert.equal(unauthorizedResponse.status, 403);

    const messageResponse = await request("PUT", `/${reminderId}`, {
      body: { message: "Edited message" },
    });
    const messagePayload = await messageResponse.json();
    assert.equal(messageResponse.status, 200);
    assert.equal(messagePayload.data.message, "Edited message");
    assert.equal(messagePayload.data.targetId, original.targetId);
    assert.equal(messagePayload.data.scheduledAt, original.scheduledAt);
    assert.equal(messagePayload.data.attachment.storagePath, original.attachment.storagePath);

    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const futureResponse = await request("PUT", `/${reminderId}`, { body: { scheduledAt: futureDate } });
    assert.equal(futureResponse.status, 200);

    const pastResponse = await request("PUT", `/${reminderId}`, {
      body: { scheduledAt: new Date(Date.now() - 60 * 1000).toISOString() },
    });
    assert.equal(pastResponse.status, 400);

    const replacementResponse = await request("PUT", `/${reminderId}`, {
      body: formWithReminder({}, {
        name: "replacement.txt",
        type: "text/plain",
        contents: "replacement attachment",
      }),
    });
    const replacementPayload = await replacementResponse.json();
    assert.equal(replacementResponse.status, 200);
    assert.notEqual(replacementPayload.data.attachment.storagePath, original.attachment.storagePath);
    assert.equal(storedFiles.has(original.attachment.storagePath), false);
    assert.equal(storedFiles.get(replacementPayload.data.attachment.storagePath).buffer.toString(), "replacement attachment");
  });

  await t.test("update retries against the current server value when the local transaction cache is empty", async () => {
    const id = "retry-update-reminder-888";
    setAt(`reminders/${id}`, {
      reminderId: id,
      createdBy: userId,
      message: "Original message",
      targetType: "private_chat",
      targetId: receiverId,
      receiverId,
      scheduledAt: Date.now() + 60_000,
      status: "pending",
    });
    transactionNullOnce.add(`reminders/${id}`);

    const response = await request("PUT", `/${id}`, {
      body: { message: "Saved despite empty local transaction cache" },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.message, "Saved despite empty local transaction cache");
    assert.equal(getAt(`reminders/${id}`).message, "Saved despite empty local transaction cache");
  });

  await t.test("cancel a future pending reminder once and expose its cancelled status", async () => {
    const response = await request("DELETE", `/${reminderId}`);
    assert.equal(response.status, 200);
    assert.equal(getAt(`reminders/${reminderId}`).status, "cancelled");

    const duplicateResponse = await request("DELETE", `/${reminderId}`);
    assert.equal(duplicateResponse.status, 409);

    const listResponse = await request("GET", "");
    const listPayload = await listResponse.json();
    assert.ok(!listPayload.data.some((reminder) => reminder.reminderId === reminderId));
    assert.equal(getAt(`reminders/${reminderId}`).status, "cancelled");
  });

  await t.test("hide sent and completed reminders from the list without deleting records", async () => {
    const reminderBase = {
      createdBy: userId,
      scheduledAt: Date.now() + 60_000,
      message: "Reminder status list test",
    };
    setAt("reminders/list-pending-123", {
      ...reminderBase,
      reminderId: "list-pending-123",
      status: "pending",
    });
    setAt("reminders/list-cancelled-123", {
      ...reminderBase,
      reminderId: "list-cancelled-123",
      status: "cancelled",
    });
    setAt("reminders/list-sent-123", {
      ...reminderBase,
      reminderId: "list-sent-123",
      status: "sent",
    });
    setAt("reminders/list-completed-123", {
      ...reminderBase,
      reminderId: "list-completed-123",
      status: "completed",
    });

    const response = await request("GET", "");
    const payload = await response.json();
    const listedIds = payload.data.map((reminder) => reminder.reminderId);

    assert.ok(listedIds.includes("list-pending-123"));
    assert.ok(!listedIds.includes("list-cancelled-123"));
    assert.ok(!listedIds.includes("list-sent-123"));
    assert.ok(!listedIds.includes("list-completed-123"));
    assert.equal(getAt("reminders/list-cancelled-123").status, "cancelled");
    assert.equal(getAt("reminders/list-sent-123").status, "sent");
    assert.equal(getAt("reminders/list-completed-123").status, "completed");
  });

  await t.test("reject cancellation of a past pending or already-triggered reminder", async () => {
    const base = {
      reminderId: "past-reminder-123",
      createdBy: userId,
      status: "pending",
      scheduledAt: Date.now() - 1000,
    };
    setAt("reminders/past-reminder-123", base);
    const pastResponse = await request("DELETE", "/past-reminder-123");
    assert.equal(pastResponse.status, 409);
    assert.equal(getAt("reminders/past-reminder-123").status, "pending");

    setAt("reminders/sent-reminder-123", { ...base, reminderId: "sent-reminder-123", status: "sent", scheduledAt: Date.now() + 60_000 });
    const sentResponse = await request("DELETE", "/sent-reminder-123");
    assert.equal(sentResponse.status, 409);
    assert.equal(getAt("reminders/sent-reminder-123").status, "sent");
  });

  await t.test("resolve legacy IDs that differ from the Realtime Database child key", async () => {
    const dbKey = "database-key-reminder-456";
    const internalId = "legacy-internal-reminder-789";
    setAt(`reminders/${dbKey}`, {
      reminderId: internalId,
      createdBy: userId,
      message: "Legacy reminder",
      targetType: "private_chat",
      targetId: receiverId,
      receiverId,
      scheduledAt: Date.now() + 60 * 60 * 1000,
      status: "pending",
    });

    const listResponse = await request("GET", "");
    const listPayload = await listResponse.json();
    const listed = listPayload.data.find((reminder) => reminder.reminderId === dbKey);
    assert.ok(listed);
    assert.notEqual(listed.reminderId, internalId);

    const legacyIdResponse = await request("GET", `/${internalId}`);
    const legacyIdPayload = await legacyIdResponse.json();
    assert.equal(legacyIdResponse.status, 200);
    assert.equal(legacyIdPayload.data.reminderId, dbKey);

    const legacyUpdateResponse = await request("PUT", `/${internalId}`, {
      body: { message: "Updated by legacy ID" },
    });
    assert.equal(legacyUpdateResponse.status, 200);
    assert.equal(getAt(`reminders/${dbKey}`).message, "Updated by legacy ID");

    const updateResponse = await request("PUT", `/${listed.reminderId}`, {
      body: { message: "Updated legacy reminder" },
    });
    assert.equal(updateResponse.status, 200);
    assert.equal(getAt(`reminders/${dbKey}`).message, "Updated legacy reminder");

    const deleteResponse = await request("DELETE", `/${listed.reminderId}`);
    assert.equal(deleteResponse.status, 200);
    assert.equal(getAt(`reminders/${dbKey}`).status, "cancelled");
    assert.equal(getAt(`reminders/${dbKey}`).reminderId, dbKey);
  });

  await t.test("distinguish missing, malformed, and unauthorized Reminder IDs", async () => {
    const missingResponse = await request("DELETE", "/missing-reminder-id");
    assert.equal(missingResponse.status, 404);
    assert.equal((await missingResponse.json()).message, "Reminder not found");

    const malformedResponse = await request("DELETE", "/bad");
    assert.equal(malformedResponse.status, 400);

    const ownedReminderId = "owned-reminder-234";
    setAt(`reminders/${ownedReminderId}`, {
      reminderId: ownedReminderId,
      createdBy: userId,
      scheduledAt: Date.now() + 60_000,
      status: "pending",
    });
    const unauthorizedResponse = await request("DELETE", `/${ownedReminderId}`, {
      token: "different-user-300",
    });
    assert.equal(unauthorizedResponse.status, 403);
    assert.equal(getAt(`reminders/${ownedReminderId}`).status, "pending");
  });
});
