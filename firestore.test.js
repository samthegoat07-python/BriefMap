const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_news_01";
const BOB_UID = "bob_news_02";

const [emulatorHost, emulatorPortStr] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"
).split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

function validPreferences(uid, ts) {
  return {
    userId: uid,
    selectedCategories: ["TECHNOLOGY", "POLITICS", "SPORTS", "EDUCATION"],
    localLocation: "San Francisco, CA",
    localLat: 37.7749,
    localLng: -122.4194,
    internationalRegions: ["Europe", "Asia-Pacific"],
    customLocations: ["Tokyo", "London"],
    prioritizeLocal: true,
    briefingDepth: "COMPACT",
    createdAt: ts,
    updatedAt: ts,
  };
}

function validBookmark(uid, ts) {
  return {
    userId: uid,
    articleKey: "art_tech_001",
    headline: "New Solid-State Battery Breakthrough Cuts EV Charging Time in Half",
    compactSummary:
      "Researchers in Kyoto demonstrated a dense solid-state battery architecture reaching 80% charge in nine minutes under standard grid conditions.",
    keyPoints: [
      "80% charge achieved in 9 minutes",
      "Commercial pilot plants planned for 2027",
    ],
    category: "TECHNOLOGY",
    scope: "INTERNATIONAL",
    locationName: "Kyoto, Japan",
    latitude: 35.0116,
    longitude: 135.7681,
    sourceName: "Global Tech Dispatch",
    sourceUrl: "https://example.org/kyoto-battery-breakthrough",
    mapsPlaceNote: "Kyoto University Innovation Park, Kyoto, Japan",
    publishedLabel: "Today • 1h ago",
    readTimeMinutes: 2,
    offlineReady: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

function validFeedback(uid, ts) {
  return {
    userId: uid,
    articleKey: "art_tech_001",
    articleHeadline: "New Solid-State Battery Breakthrough Cuts EV Charging Time in Half",
    category: "TECHNOLOGY",
    helpfulVote: "UP",
    accuracyRating: 5,
    helpfulnessRating: 4,
    inaccuracyReport: "",
    improvementSuggestion: "Include exact cost per kWh estimate when available.",
    createdAt: ts,
    updatedAt: ts,
  };
}

test("Unauthenticated users cannot read or write preferences, bookmarks, or feedback", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  const ts = new Date(Date.now() - 2000);

  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("preferences").doc("settings").get()
  );
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("bookmarks").get()
  );
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("feedback").get()
  );
  await assertFails(
    unauthDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("preferences")
      .doc("settings")
      .set(validPreferences(ALICE_UID, ts))
  );
});

test("Preferences: owner can create, read, and partially update; ghost fields and immutable mutations fail", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const created = new Date(Date.now() - 10000);
  const prefRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("preferences")
    .doc("settings");

  await assertSucceeds(prefRef.set(validPreferences(ALICE_UID, created)));
  await assertSucceeds(prefRef.get());

  // Valid partial update
  await assertSucceeds(
    prefRef.update({
      localLocation: "Austin, TX",
      localLat: 30.2672,
      localLng: -97.7431,
      selectedCategories: ["TECHNOLOGY", "EDUCATION"],
      briefingDepth: "FLASH",
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject immutable createdAt mutation
  await assertFails(
    prefRef.update({
      createdAt: new Date(Date.now() - 500),
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Reject ghost field
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("preferences")
      .doc("settings_ghost")
      .set({ ...validPreferences(ALICE_UID, created), isAdmin: true })
  );

  // Reject invalid category enum
  await assertFails(
    prefRef.update({
      selectedCategories: ["GOSSIP"],
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject future timestamp
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("preferences")
      .doc("settings_future")
      .set(validPreferences(ALICE_UID, new Date(Date.now() + 60000)))
  );
});

test("Bookmarks: owner can create, list, update, delete; extra id key & cross-user access fail", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = new Date(Date.now() - 10000);

  const bmRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("bookmarks")
    .doc("art_tech_001");

  await assertSucceeds(bmRef.set(validBookmark(ALICE_UID, created)));

  // Kotlin repository list query
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("bookmarks").get()
  );

  // Reject writing @DocumentId `id` field inside payload
  await assertFails(
    aliceDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("bookmarks")
      .doc("art_tech_002")
      .set({ ...validBookmark(ALICE_UID, created), id: "art_tech_002" })
  );

  // Reject cross-user read, list, update, delete
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("bookmarks").doc("art_tech_001").get()
  );
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("bookmarks").get()
  );
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("bookmarks")
      .doc("art_tech_001")
      .delete()
  );

  // Owner delete succeeds
  await assertSucceeds(bmRef.delete());
});

test("Feedback: owner can create, list, and update rating; out-of-range stars and cross-user fail", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = new Date(Date.now() - 10000);

  const fbRef = aliceDb
    .collection("users")
    .doc(ALICE_UID)
    .collection("feedback")
    .doc("art_tech_001");

  await assertSucceeds(fbRef.set(validFeedback(ALICE_UID, created)));
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("feedback").get()
  );

  // Valid partial update
  await assertSucceeds(
    fbRef.update({
      helpfulVote: "DOWN",
      accuracyRating: 2,
      inaccuracyReport: "Battery density figure needs verification.",
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Out-of-range star rating rejected
  await assertFails(
    fbRef.update({
      accuracyRating: 6,
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Cross-user access rejected
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("feedback").doc("art_tech_001").get()
  );
  await assertFails(
    bobDb
      .collection("users")
      .doc(ALICE_UID)
      .collection("feedback")
      .doc("art_tech_002")
      .set(validFeedback(ALICE_UID, created))
  );
});
