const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

const database = {};
const storedFiles = new Map();

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
      transaction: async (update) => {
        const current = getAt(pathName) ?? null;
        const next = update(current);
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
  getDb: () => ({}),
  getBucket: () => fakeBucket,
};
require.cache[firebaseConfigPath] = fakeFirebaseConfig;

process.env.JWT_SECRET = "reminder-test-secret";
process.env.NODE_ENV = "test";

const reminderRoutes = require("./reminder.routes");
const app = express();
app.use(express.json());
app.use("/api/reminders", reminderRoutes);

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

  await t.test("create without a file and reject past dates at the API", async () => {
    const response = await request("POST", "", {
      body: reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.status, "pending");
    assert.equal(payload.data.attachment, null);

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
    const response = await request("POST", "", {
      body: formWithReminder(reminderFields(new Date(Date.now() + 60 * 60 * 1000).toISOString()), {
        name: "notes.txt",
        type: "text/plain",
        contents: "actual reminder attachment",
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.data.attachment.fileType, "document");
    assert.equal(payload.data.attachment.mimeType, "text/plain");
    assert.match(payload.data.attachment.url, /^https:\/\/storage\.test\//);
    assert.equal(storedFiles.get(payload.data.attachment.storagePath).buffer.toString(), "actual reminder attachment");
    assert.equal(getAt(`reminders/${payload.data.reminderId}`).attachment.storagePath, payload.data.attachment.storagePath);
    reminderId = payload.data.reminderId;
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

  await t.test("cancel a future pending reminder once and expose its cancelled status", async () => {
    const response = await request("DELETE", `/${reminderId}`);
    assert.equal(response.status, 200);
    assert.equal(getAt(`reminders/${reminderId}`).status, "cancelled");

    const duplicateResponse = await request("DELETE", `/${reminderId}`);
    assert.equal(duplicateResponse.status, 409);

    const listResponse = await request("GET", "");
    const listPayload = await listResponse.json();
    assert.equal(listPayload.data.find((reminder) => reminder.reminderId === reminderId).status, "cancelled");
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
});
