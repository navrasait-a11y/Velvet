const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");
const { once } = require("node:events");
const axios = require("axios");
const otpService = require("./otp.service");

const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const app = require("../app");
if (originalNodeEnvironment === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnvironment;
}

const environmentKeys = [
  "APITXT_API_KEY",
  "APITXT_BASE_URL",
  "APITXT_OTP_ENDPOINT",
  "APITXT_TEMPLATE_ID",
  "NODE_ENV",
  "TEST_OTP",
];
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  process.env.APITXT_API_KEY = "test-api-key";
  process.env.APITXT_BASE_URL = "https://apitxt.com";
  process.env.APITXT_OTP_ENDPOINT = "/api/sendOTP";
  delete process.env.APITXT_TEMPLATE_ID;
  process.env.NODE_ENV = "test";
  delete process.env.TEST_OTP;
});

afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnvironment[key];
    }
  }
});

test("sends the generated four-digit OTP through APITxT and verifies that session", async (t) => {
  let request;
  t.mock.method(axios, "post", async (...args) => {
    request = args;
    return { data: { success: true } };
  });

  const sessionId = await otpService.sendOtp("9876543210");
  const [url, body, config] = request;
  const form = new URLSearchParams(body);
  const otp = form.get("otp");

  assert.equal(url, "https://apitxt.com/api/sendOTP");
  assert.equal(config.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(form.get("authkey"), "test-api-key");
  assert.equal(form.get("mobile"), "9876543210");
  assert.equal(form.get("channel"), "sms");
  assert.match(otp, /^\d{4}$/);
  assert.equal(await otpService.verifyOtp(sessionId, otp, "919876543210"), true);
});

test("enforces a 15-second resend cooldown for the normalized phone number", async (t) => {
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));
  const phone = "919876543211";
  await otpService.sendOtp(phone);

  await assert.rejects(
    otpService.sendOtp("9876543211"),
    (error) => error.status === 429 && /15 seconds/.test(error.message)
  );
});

test("expires the OTP session after ten minutes", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));

  const sessionId = await otpService.sendOtp("9876543212");
  now += 10 * 60 * 1000;

  await assert.rejects(
    otpService.verifyOtp(sessionId, "1234", "9876543212"),
    /invalid or has expired/
  );
});

test("invalidates the session after four incorrect verification attempts", async (t) => {
  let request;
  t.mock.method(axios, "post", async (...args) => {
    request = args;
    return { data: { success: true } };
  });

  const sessionId = await otpService.sendOtp("9876543213");
  const correctOtp = new URLSearchParams(request[1]).get("otp");
  const incorrectOtp = correctOtp === "000000" ? "000001" : "000000";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      otpService.verifyOtp(sessionId, incorrectOtp, "9876543213"),
      /OTP verification failed/
    );
  }

  await assert.rejects(
    otpService.verifyOtp(sessionId, correctOtp, "9876543213"),
    /invalid or has expired/
  );
});

test("rejects a session when the supplied phone number does not match", async (t) => {
  let request;
  t.mock.method(axios, "post", async (...args) => {
    request = args;
    return { data: { success: true } };
  });

  const sessionId = await otpService.sendOtp("9876543214");
  const otp = new URLSearchParams(request[1]).get("otp");

  await assert.rejects(
    otpService.verifyOtp(sessionId, otp, "9876543215"),
    /invalid or has expired/
  );
});

test("limits OTP requests to five per minute for each normalized phone number", async (t) => {
  let now = 1_800_000_100_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));

  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  await once(server, "listening");

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/auth/send-otp`;
  const phone = "9876543216";

  for (let request = 0; request < 5; request += 1) {
    now += 16 * 1000;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(typeof payload.sessionId, "string");
  }

  const limitedResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "91" + phone }),
  });
  assert.equal(limitedResponse.status, 429);
});
