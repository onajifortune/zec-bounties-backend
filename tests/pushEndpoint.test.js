const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { isAllowedPushEndpoint } = require("../utils/pushEndpoint");

const CHROME = "https://fcm.googleapis.com/fcm/send/abc:def";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

test("push endpoints from browser push services are allowed", () => {
  for (const url of [
    CHROME,
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://web.push.apple.com/QGuQ",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ]) {
    assert.equal(isAllowedPushEndpoint(url), true, url);
  }
});

test("other push endpoints are refused", () => {
  for (const url of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user@fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://evilpush.apple.com.test/x",
    "https://169.254.169.254/latest",
    "https://localhost/x",
    "not a url",
    undefined,
  ]) {
    assert.equal(isAllowedPushEndpoint(url), false, String(url));
  }
});

function loadSubscribe(existing = []) {
  const effects = { upserts: [], deleted: [] };
  const routes = {};
  const db = {
    pushSubscription: {
      upsert: async (args) => effects.upserts.push(args),
      findMany: async ({ skip }) => existing.slice(skip),
      deleteMany: async ({ where }) => effects.deleted.push(...where.id.in),
    },
  };
  const dependencies = {
    express: {
      Router: () =>
        new Proxy({}, { get: (_, method) => (url, ...handlers) => { routes[`${method} ${url}`] = handlers; } }),
    },
    "../prisma/client": db,
    "../middleware/auth": { authenticate: () => {} },
    "../utils/pushEndpoint": require("../utils/pushEndpoint"),
  };
  const filename = path.join(__dirname, "../routes/notifications.js");
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) => dependencies[name],
      console: { log() {}, error() {} },
    },
    { filename },
  );
  return {
    effects,
    async call(body) {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };
      await routes["post /push/subscribe"].at(-1)({ user: { id: "u1" }, body }, res);
      return res;
    },
  };
}

test("subscribing with a push service endpoint is saved", async () => {
  const route = loadSubscribe();
  const res = await route.call({ endpoint: CHROME, keys: KEYS });
  assert.equal(res.statusCode, 200);
  assert.equal(route.effects.upserts.length, 1);
});

test("subscribing with any other endpoint or bad keys is refused", async () => {
  for (const body of [
    { endpoint: "https://internal.example/hook", keys: KEYS },
    { endpoint: CHROME, keys: { p256dh: { $ne: 1 }, auth: KEYS.auth } },
    { endpoint: CHROME, keys: { p256dh: KEYS.p256dh, auth: "x".repeat(500) } },
    { endpoint: [CHROME], keys: KEYS },
  ]) {
    const route = loadSubscribe();
    const res = await route.call(body);
    assert.equal(res.statusCode, 400);
    assert.equal(route.effects.upserts.length, 0);
  }
});

test("a user keeps only their newest subscriptions", async () => {
  const existing = ["s7", "s6", "s5", "s4", "s3", "s2", "s1"].map((id) => ({ id }));
  const route = loadSubscribe(existing);
  await route.call({ endpoint: CHROME, keys: KEYS });
  assert.deepEqual(route.effects.deleted, ["s2", "s1"]);
});

test("a stored subscription to another host gets no request", async () => {
  const pushLib = require.resolve("../utils/pushNotifications");
  let sent = 0;
  require.cache[pushLib] = {
    id: pushLib,
    filename: pushLib,
    loaded: true,
    exports: { sendNotification: async () => sent++ },
  };
  const sendPushNotification = require("../utils/sendPushNotification");
  const kept = await sendPushNotification({ endpoint: "https://10.0.0.1/x", ...KEYS }, {});
  assert.equal(kept, false);
  assert.equal(sent, 0);
  assert.equal(await sendPushNotification({ endpoint: CHROME, ...KEYS }, {}), true);
  assert.equal(sent, 1);
});
