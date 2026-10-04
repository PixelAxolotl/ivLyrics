import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");

// Extract the migration IIFE and TrackSyncDB for testing
const migrationStart = source.indexOf("// Migrate from localStorage to IndexedDB");
const migrationEnd = source.indexOf("const SettingsPersistence", migrationStart);
const migrationCode = source.slice(migrationStart, migrationEnd);

const trackSyncDBStart = source.indexOf("const TrackSyncDB = {");
const trackSyncDBEnd = source.indexOf("// TrackSyncDB", trackSyncDBStart);
const trackSyncDBCode = source.slice(trackSyncDBStart, trackSyncDBEnd);

// Extract everything from normalizeTrackSyncOffsets through initDB (non-overlapping)
const normalizeStart = source.indexOf("const normalizeTrackSyncOffsets = (");
const normalizeEnd = source.indexOf("const TrackSyncDB = {", normalizeStart);
const normalizeCode = source.slice(normalizeStart, normalizeEnd);

// Extract DB constants (before normalizeTrackSyncOffsets)
const dbNameStart = source.indexOf('const DB_NAME = "ivLyrics-db"');
const dbNameEnd = source.indexOf("const normalizeTrackSyncOffsets", dbNameStart);
const dbConstantsCode = source.slice(dbNameStart, dbNameEnd);

// Minimal fake IndexedDB that properly simulates transaction completion
const createFakeIndexedDB = (initialData = {}) => {
  const data = new Map(Object.entries(initialData));
  let dbInstance = null;

  const createStore = () => ({
    clear: () => {
      const req = {};
      queueMicrotask(() => {
        data.clear();
        req.onsuccess?.();
      });
      return req;
    },
    put: (value, key) => {
      data.set(key, value);
      const req = {};
      queueMicrotask(() => {
        req.onsuccess?.();
      });
      return req;
    },
    getAllKeys: () => {
      const req = {};
      queueMicrotask(() => {
        req.result = [...data.keys()];
        req.onsuccess?.();
      });
      return req;
    },
    getAll: () => {
      const req = {};
      queueMicrotask(() => {
        req.result = [...data.values()];
        req.onsuccess?.();
      });
      return req;
    },
    get: (key) => {
      const req = {};
      queueMicrotask(() => {
        req.result = data.has(key) ? data.get(key) : undefined;
        req.onsuccess?.();
      });
      return req;
    },
  });

  const open = () => {
    const request = {};
    queueMicrotask(() => {
      if (!dbInstance) {
        dbInstance = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => createStore(),
          transaction: (_storeName, _mode) => {
            const transaction = {
              objectStore: createStore,
              oncomplete: null,
              onerror: null,
              onabort: null,
            };
            // Real IndexedDB fires oncomplete after requests settle.
            // Fire on a macrotask so handlers assigned synchronously
            // after transaction() returns are observed.
            setTimeout(() => {
              try {
                transaction.oncomplete?.();
              } catch {
                // Handlers own their errors; never break the mock.
              }
            }, 0);
            return transaction;
          },
          close: () => {},
        };
      }
      request.result = dbInstance;
      request.onsuccess?.();
    });
    return request;
  };

  return { open, data };
};

const createHarness = ({ existingOffsets = null, legacyOffsets = null } = {}) => {
  const values = new Map();
  if (legacyOffsets !== null) {
    values.set("ivLyrics:track-sync-offsets", legacyOffsets);
  }

  const localStorage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  const indexedDB = createFakeIndexedDB(existingOffsets || {});

  const warnings = [];
  const errors = [];
  const logs = [];

  const window = {
    console: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
      log: (...args) => logs.push(args),
    },
  };

  const context = {
    window,
    localStorage,
    indexedDB,
    console: window.console,
    ivLyricsDebug: (...args) => logs.push(args),
    queueMicrotask,
    setTimeout,
    Promise,
    Object,
    JSON,
    Number,
    Math,
    Date,
    Array,
    Error,
    Set,
    Map,
  };

  // Build a testable module from the extracted code
  // normalizeCode already includes initDB (it's between normalizeTrackSyncOffsets and TrackSyncDB)
  const moduleCode = `
    ${dbConstantsCode}
    ${normalizeCode}
    ${trackSyncDBCode}
    ${migrationCode}
  `;

  vm.createContext(context);
  vm.runInContext(moduleCode, context);

  return {
    values,
    indexedDBData: indexedDB.data,
    warnings,
    errors,
    logs,
    window,
  };
};

const flushAsync = async (ms = 300) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("migration does not overwrite existing IndexedDB offsets with older localStorage data", async () => {
  const harness = createHarness({
    existingOffsets: { "spotify:track:abc": 5000 },
    legacyOffsets: JSON.stringify({ "spotify:track:abc": 1000 }),
  });

  await flushAsync();

  // The existing IndexedDB offset (5000) should NOT be overwritten by the legacy localStorage value (1000)
  assert.equal(
    harness.indexedDBData.get("spotify:track:abc"),
    5000,
    "Existing IndexedDB offsets must not be overwritten by legacy localStorage data"
  );
});

test("migration proceeds when IndexedDB has no existing offsets", async () => {
  const harness = createHarness({
    existingOffsets: null,
    legacyOffsets: JSON.stringify({ "spotify:track:abc": 1000 }),
  });

  await flushAsync();

  assert.equal(
    harness.indexedDBData.get("spotify:track:abc"),
    1000,
    "Legacy offsets should be migrated when IndexedDB is empty"
  );
  assert.equal(
    harness.values.has("ivLyrics:track-sync-offsets"),
    false,
    "Legacy localStorage key should be removed after successful migration"
  );
});

test("migration keeps legacy data when IndexedDB import fails", async () => {
  const values = new Map();
  values.set("ivLyrics:track-sync-offsets", JSON.stringify({ "spotify:track:abc": 1000 }));

  const localStorage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  const indexedDB = {
    open() {
      throw new Error("IndexedDB unavailable");
    },
  };

  const warnings = [];
  const errors = [];

  const window = {
    console: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
      log: () => {},
    },
  };

  const context = {
    window,
    localStorage,
    indexedDB,
    console: window.console,
    ivLyricsDebug: () => {},
    queueMicrotask,
    setTimeout,
    Promise,
    Object,
    JSON,
    Number,
    Math,
    Date,
    Array,
    Error,
    Set,
    Map,
  };

  const moduleCode = `
    ${dbConstantsCode}
    ${normalizeCode}
    ${trackSyncDBCode}
    ${migrationCode}
  `;

  vm.createContext(context);
  vm.runInContext(moduleCode, context);

  await flushAsync();

  assert.equal(
    values.has("ivLyrics:track-sync-offsets"),
    true,
    "Legacy localStorage key must be preserved when IndexedDB import fails"
  );
});
