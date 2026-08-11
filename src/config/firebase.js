const admin = require("firebase-admin");
const path = require("path");

let db;
let rtdb;
let bucket;
let dbProxy;
let rtdbProxy;
let bucketProxy;

const initializeFirebase = () => {
  if (admin.apps.length > 0) return admin.app();

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    credential = admin.credential.cert(serviceAccount);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    const serviceAccount = require(serviceAccountPath);
    credential = admin.credential.cert(serviceAccount);
  } else {
    credential = admin.credential.cert({
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    });
  }

  admin.initializeApp({
    credential,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  return admin.app();
};

const initializeFirestore = () => {
  if (!db) {
    initializeFirebase();
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
};

const initializeRealtimeDb = () => {
  if (!rtdb) {
    initializeFirebase();
    rtdb = admin.database();
  }
  return rtdb;
};

const initializeBucket = () => {
  if (!bucket) {
    initializeFirebase();
    bucket = admin.storage().bucket();
  }
  return bucket;
};

const createLazyProxy = (resolver) =>
  new Proxy(
    {},
    {
      get(_, prop) {
        const target = resolver();
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(_, prop, value) {
        const target = resolver();
        target[prop] = value;
        return true;
      },
      has(_, prop) {
        return prop in resolver();
      },
    }
  );

const getDb = () => db || (dbProxy ||= createLazyProxy(initializeFirestore));

const getRealtimeDb = () => rtdb || (rtdbProxy ||= createLazyProxy(initializeRealtimeDb));

const getBucket = () => bucket || (bucketProxy ||= createLazyProxy(initializeBucket));

const ensureFirebaseInitialized = () => {
  initializeFirebase();
  initializeFirestore();
  initializeRealtimeDb();
  initializeBucket();
};

const getTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

module.exports = {
  admin,
  ensureFirebaseInitialized,
  getDb,
  getRealtimeDb,
  getBucket,
  getTimestamp,
};
