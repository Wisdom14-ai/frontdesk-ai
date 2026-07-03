import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

/**
 * Faithful stub of isAutomationSchemaMismatchError (the schema-tolerance helper
 * the disconnect-alert module reuses). Mirrors src/lib/server/automation.ts.
 */
function isAutomationSchemaMismatchError(error) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205"
  );
}

/**
 * Transpile the REAL alert module (TypeScript) to CommonJS with the same SWC
 * bindings Next uses, then load it with its two non-type imports stubbed. This
 * exercises the shipped recordWhatsappDisconnect / isWhatsappDisconnectTransition
 * source directly — not a re-implementation.
 */
async function loadDisconnectAlertModule() {
  const swc = require("next/dist/build/swc");
  const bindings = await swc.loadBindings();
  const source = fs.readFileSync(
    path.join(projectRoot, "src", "lib", "server", "whatsapp-disconnect-alert.ts"),
    "utf8"
  );
  const { code } = await bindings.transform(source, {
    jsc: { parser: { syntax: "typescript" }, target: "es2020" },
    module: { type: "commonjs" },
  });

  const stubRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/automation") {
      return { isAutomationSchemaMismatchError };
    }
    return require(specifier);
  };

  const moduleObj = { exports: {} };
  const factory = new Function("exports", "require", "module", code);
  factory(moduleObj.exports, stubRequire, moduleObj);
  return moduleObj.exports;
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// In-memory Supabase double. Only the query shapes recordWhatsappDisconnect
// uses are supported: select().eq().eq().gte().limit() and insert().
// insert() stamps created_at like the DB `default now()` so dedupe-by-recency
// behaves as it does in Postgres.
// ---------------------------------------------------------------------------
class FakeBuilder {
  constructor(db, table, onInsertError) {
    this.db = db;
    this.table = table;
    this.onInsertError = onInsertError;
    this.filters = [];
    this.limitCount = null;
    this.selectError = null;
  }

  select() {
    // Allow tests to force a lookup error (e.g. missing table).
    if (this.db.__selectError && this.table === "clinic_notifications") {
      this.selectError = this.db.__selectError;
    }
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] !== undefined && row[column] >= value);
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  insert(payload) {
    if (this.onInsertError && this.onInsertError()) {
      return Promise.resolve({ data: null, error: this.onInsertError() });
    }
    const rows = Array.isArray(payload) ? payload : [payload];
    const nowIso = new Date().toISOString();
    for (const row of rows) {
      this.db[this.table].push({ created_at: nowIso, ...row });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  execute() {
    if (this.selectError) {
      return { data: null, error: this.selectError };
    }
    let rows = (this.db[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    if (typeof this.limitCount === "number") {
      rows = rows.slice(0, this.limitCount);
    }
    return { data: rows.map((row) => ({ ...row })), error: null };
  }
}

class FakeAdmin {
  constructor(seed, opts = {}) {
    this.db = seed;
    this.opts = opts;
  }

  from(table) {
    return new FakeBuilder(this.db, table, this.opts.onInsertError);
  }
}

/**
 * Mirror the webhook route's connection-lifecycle branch EXACTLY, using the same
 * two exported functions the route calls. This is the "simulate a disconnect
 * webhook payload against a test clinic" driver.
 */
async function simulateConnectionLifecycleEvent(mod, admin, clinicRow, event) {
  // Route: capture stored status BEFORE overwriting it.
  const wasConnected = mod.isWhatsappDisconnectTransition(clinicRow.whatsapp_status);

  // Route: overwrite the clinic to the non-connected state.
  clinicRow.whatsapp_status = "pending_qr";

  // Route: fire the alert only on the transition out of `connected`.
  if (wasConnected) {
    await mod.recordWhatsappDisconnect({
      admin,
      clinicId: clinicRow.id,
      event: event.event,
      state: event.state,
    });
  }

  return { wasConnected };
}

const TEST_CLINIC_ID = "test-clinic-throwaway";

const mod = await loadDisconnectAlertModule();

test("disconnect transition inserts one critical whatsapp_disconnected alert", async () => {
  const db = { clinic_notifications: [] };
  const admin = new FakeAdmin(db);
  const clinic = { id: TEST_CLINIC_ID, whatsapp_status: "connected" };

  const { wasConnected } = await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "connection.update",
    state: "close",
  });

  assert.equal(wasConnected, true, "should detect the connected -> pending_qr transition");
  assert.equal(clinic.whatsapp_status, "pending_qr");
  assert.equal(db.clinic_notifications.length, 1, "exactly one alert row inserted");

  const row = db.clinic_notifications[0];
  assert.equal(row.clinic_id, TEST_CLINIC_ID);
  assert.equal(row.severity, "critical");
  assert.equal(row.category, "whatsapp_disconnected");
  assert.match(row.body, /re-scan the QR code/i);
  assert.match(row.body, /cannot reply/i);
  assert.equal(row.metadata.event, "connection.update");
  assert.equal(row.metadata.state, "close");
});

test("no alert fires during initial QR setup (was never connected)", async () => {
  const db = { clinic_notifications: [] };
  const admin = new FakeAdmin(db);
  const clinic = { id: TEST_CLINIC_ID, whatsapp_status: "pending_qr" };

  const { wasConnected } = await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "qrcode.updated",
    state: null,
  });

  assert.equal(wasConnected, false);
  assert.equal(db.clinic_notifications.length, 0, "no alert for pending_qr -> pending_qr");
});

test("flapping connection within 6h is deduped to a single alert", async () => {
  const db = { clinic_notifications: [] };
  const admin = new FakeAdmin(db);
  const clinic = { id: TEST_CLINIC_ID, whatsapp_status: "connected" };

  // First drop.
  await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "connection.update",
    state: "close",
  });
  // Reconnect + immediately drop again (flap).
  clinic.whatsapp_status = "connected";
  await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "connection.update",
    state: "connecting",
  });

  assert.equal(db.clinic_notifications.length, 1, "second drop within 6h must not spam");
});

test("re-alerts once the 6h dedupe window has passed", async () => {
  const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const db = {
    clinic_notifications: [
      {
        id: "old",
        clinic_id: TEST_CLINIC_ID,
        severity: "critical",
        category: "whatsapp_disconnected",
        created_at: stale,
        metadata: {},
      },
    ],
  };
  const admin = new FakeAdmin(db);
  const clinic = { id: TEST_CLINIC_ID, whatsapp_status: "connected" };

  await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "connection.update",
    state: "close",
  });

  assert.equal(db.clinic_notifications.length, 2, "a fresh alert is inserted after 6h");
});

test("scoped per clinic: another clinic's recent alert does not suppress this one", async () => {
  const recent = new Date().toISOString();
  const db = {
    clinic_notifications: [
      {
        id: "other",
        clinic_id: "some-other-clinic",
        severity: "critical",
        category: "whatsapp_disconnected",
        created_at: recent,
        metadata: {},
      },
    ],
  };
  const admin = new FakeAdmin(db);
  const clinic = { id: TEST_CLINIC_ID, whatsapp_status: "connected" };

  await simulateConnectionLifecycleEvent(mod, admin, clinic, {
    event: "connection.update",
    state: "close",
  });

  const forThisClinic = db.clinic_notifications.filter(
    (r) => r.clinic_id === TEST_CLINIC_ID
  );
  assert.equal(forThisClinic.length, 1);
});

test("schema-tolerant: a missing notifications table never throws and never blind-inserts", async () => {
  const db = {
    clinic_notifications: [],
    __selectError: { code: "42P01", message: 'relation "clinic_notifications" does not exist' },
  };
  const admin = new FakeAdmin(db);

  // Must resolve (not reject) — observability can never block webhook processing.
  await mod.recordWhatsappDisconnect({ admin, clinicId: TEST_CLINIC_ID, event: "connection.update", state: "close" });

  assert.equal(db.clinic_notifications.length, 0, "must not blind-insert when dedupe lookup fails");
});

test("recordWhatsappDisconnect swallows an unexpected insert error", async () => {
  const db = { clinic_notifications: [] };
  const admin = new FakeAdmin(db, {
    onInsertError: () => ({ code: "XX000", message: "boom" }),
  });

  await mod.recordWhatsappDisconnect({ admin, clinicId: TEST_CLINIC_ID });
  // No throw == pass; nothing was inserted because insert reported an error.
  assert.equal(db.clinic_notifications.length, 0);
});

// ---------------------------------------------------------------------------
// Wiring assertions (repo precedent: middleware/auth tests assert on source).
// ---------------------------------------------------------------------------
test("webhook route fires the alert only on the connected -> non-connected transition", () => {
  const routeSource = fs.readFileSync(
    path.join(projectRoot, "src", "app", "api", "webhooks", "whatsapp", "route.ts"),
    "utf8"
  );

  // Guard is derived from the stored status BEFORE the pending_qr write.
  assert.match(routeSource, /const wasConnected = isWhatsappDisconnectTransition\(/);
  // The alert call is guarded by that transition.
  assert.match(
    routeSource,
    /if \(wasConnected\) \{\s*await recordWhatsappDisconnect\(/
  );
});

test("status is surfaced by existing UI (verify, do not duplicate)", () => {
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "src", "app", "(dashboard)", "dashboard", "page.tsx"),
    "utf8"
  );
  const liveStatusSource = fs.readFileSync(
    path.join(projectRoot, "src", "lib", "server", "clinic-live-status.ts"),
    "utf8"
  );
  const checklistSource = fs.readFileSync(
    path.join(projectRoot, "src", "lib", "server", "admin-analytics.ts"),
    "utf8"
  );

  // Dashboard renders a red banner off the live-state check.
  assert.match(dashboardSource, /BotOfflineBanner/);
  assert.match(dashboardSource, /border-red-300 bg-red-50/);
  // Live-state and the admin go-live checklist both read whatsapp_status.
  assert.match(liveStatusSource, /whatsappStatus !== "connected"/);
  assert.match(checklistSource, /clinic\.whatsapp_status === "connected"/);
});
