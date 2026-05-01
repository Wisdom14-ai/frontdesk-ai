import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

function loadRouteUserland(...routeSegments) {
  const routeModule = require(path.join(
    projectRoot,
    ".next",
    "server",
    ...routeSegments,
    "route.js"
  ));

  return routeModule.routeModule.userland;
}

function loadBuiltContactMemoryExports() {
  const runtime = require(path.join(
    projectRoot,
    ".next",
    "server",
    "webpack-runtime.js"
  ));
  require(
    path.join(
      projectRoot,
      ".next",
      "server",
      "app",
      "api",
      "contact-memory",
      "run-due",
      "route.js"
    )
  );

  const contactMemoryModuleEntry = Object.entries(runtime.m).find(([, mod]) => {
    const source = typeof mod === "function" ? mod.toString() : "";

    return (
      source.includes(
        "Set OPENAI_API_KEY and LEAD_MEMORY_MODEL to generate lead memory."
      ) &&
      source.includes("contact_memory_jobs") &&
      source.includes("lead_memory_last_error")
    );
  });

  assert.ok(
    contactMemoryModuleEntry,
    "Could not resolve the built contact-memory module."
  );

  const compiledExports = runtime(Number(contactMemoryModuleEntry[0]));

  return {
    enqueueContactMemoryJob: compiledExports.FH,
    runDueContactMemoryJobs: compiledExports.pH,
  };
}

class FakeBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.orderBy = null;
    this.limitCount = null;
    this.selectColumns = null;
    this.payload = null;
  }

  select(columns) {
    this.selectColumns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column, values) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  order(column, options) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  insert(payload) {
    const rows = Array.isArray(payload) ? payload : [payload];

    for (const row of rows) {
      this.db[this.table].push({ ...row });
    }

    return Promise.resolve({ data: null, error: null });
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  execute(single) {
    let rows = this.db[this.table].filter((row) =>
      this.filters.every((filter) => filter(row))
    );

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((left, right) => {
        if (left[column] === right[column]) {
          return 0;
        }

        return left[column] < right[column]
          ? ascending
            ? -1
            : 1
          : ascending
            ? 1
            : -1;
      });
    }

    if (typeof this.limitCount === "number") {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.operation === "update") {
      const updated = [];

      for (const row of rows) {
        for (const [key, value] of Object.entries(this.payload ?? {})) {
          if (value !== undefined) {
            row[key] = value;
          }
        }

        updated.push({ ...row });
      }

      rows = updated;
    } else {
      rows = rows.map((row) => ({ ...row }));
    }

    if (single) {
      return { data: rows[0] ?? null, error: null };
    }

    return {
      data: this.operation === "update" ? (this.selectColumns ? rows : null) : rows,
      error: null,
    };
  }
}

class FakeAdmin {
  constructor(seed) {
    this.db = seed;
  }

  from(table) {
    return new FakeBuilder(this.db, table);
  }
}

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("runner routes fail closed when no runner secret is configured", async () => {
  const campaignsRoute = loadRouteUserland(
    "app",
    "api",
    "campaigns",
    "run-due"
  );
  const automationRoute = loadRouteUserland(
    "app",
    "api",
    "automation",
    "run-due"
  );
  const contactMemoryRoute = loadRouteUserland(
    "app",
    "api",
    "contact-memory",
    "run-due"
  );

  await withEnv(
    {
      AUTOMATION_RUNNER_SECRET: null,
      CAMPAIGN_RUNNER_SECRET: null,
      CONTACT_MEMORY_RUNNER_SECRET: null,
      CRON_SECRET: null,
    },
    async () => {
      const campaignsResponse = await campaignsRoute.GET(
        new Request("http://localhost/api/campaigns/run-due", { method: "GET" })
      );
      assert.equal(campaignsResponse.status, 503);
      assert.match(
        (await campaignsResponse.json()).error,
        /CAMPAIGN_RUNNER_SECRET|AUTOMATION_RUNNER_SECRET|CRON_SECRET/
      );

      const automationResponse = await automationRoute.GET(
        new Request("http://localhost/api/automation/run-due", { method: "GET" })
      );
      assert.equal(automationResponse.status, 503);
      assert.match(
        (await automationResponse.json()).error,
        /AUTOMATION_RUNNER_SECRET|CRON_SECRET/
      );

      const contactMemoryResponse = await contactMemoryRoute.GET(
        new Request("http://localhost/api/contact-memory/run-due", {
          method: "GET",
        })
      );
      assert.equal(contactMemoryResponse.status, 503);
      assert.match(
        (await contactMemoryResponse.json()).error,
        /CONTACT_MEMORY_RUNNER_SECRET|AUTOMATION_RUNNER_SECRET|CRON_SECRET/
      );
    }
  );
});

test("middleware keeps scheduler runner routes public", () => {
  const middlewareSource = fs.readFileSync(
    path.join(projectRoot, "src", "middleware.ts"),
    "utf8"
  );

  for (const route of [
    "/api/automation/run-due",
    "/api/campaigns/run-due",
    "/api/contact-memory/run-due",
  ]) {
    assert.match(
      middlewareSource,
      new RegExp(`pathname\\.startsWith\\("${route}"\\)`)
    );
  }
});

test("middleware keeps root domain redirects canonical", () => {
  const middlewareSource = fs.readFileSync(
    path.join(projectRoot, "src", "middleware.ts"),
    "utf8"
  );

  assert.match(middlewareSource, /DEFAULT_ROOT_REDIRECT_DOMAIN = "frontdesk-ai\.cloud"/);
  assert.match(middlewareSource, /ROOT_REDIRECT_DOMAIN/);
  assert.match(middlewareSource, /NextResponse\.redirect\(redirectUrl, 308\)/);
});

test("contact memory enqueue collapses duplicate pending jobs per contact", async () => {
  const { enqueueContactMemoryJob } = loadBuiltContactMemoryExports();
  const now = Date.now();
  const admin = new FakeAdmin({
    contact_memory_jobs: [],
    clinics: [],
    contacts: [],
    messages: [],
  });

  await enqueueContactMemoryJob(admin, {
    clinicId: "clinic-1",
    contactId: "contact-1",
    triggerSource: "message_inbound",
    scheduledFor: new Date(now + 60_000),
  });

  await enqueueContactMemoryJob(admin, {
    clinicId: "clinic-1",
    contactId: "contact-1",
    triggerSource: "manual_refresh",
    scheduledFor: new Date(now),
  });

  assert.equal(admin.db.contact_memory_jobs.length, 1);
  assert.equal(admin.db.contact_memory_jobs[0].trigger_source, "manual_refresh");
  assert.equal(admin.db.contact_memory_jobs[0].attempt_count, 0);
  assert.equal(
    admin.db.contact_memory_jobs[0].scheduled_for,
    new Date(now).toISOString()
  );
});

test("contact memory jobs stay pending when AI config is missing", async () => {
  const { runDueContactMemoryJobs } = loadBuiltContactMemoryExports();
  const now = Date.now();
  const admin = new FakeAdmin({
    contact_memory_jobs: [
      {
        id: "job-1",
        clinic_id: "clinic-1",
        contact_id: "contact-1",
        trigger_source: "message_inbound",
        attempt_count: 2,
        status: "pending",
        scheduled_for: new Date(now - 60_000).toISOString(),
        last_error: null,
        updated_at: new Date(now - 60_000).toISOString(),
        completed_at: null,
      },
    ],
    clinics: [
      {
        id: "clinic-1",
        name: "Clinic",
        clinic_prompt: null,
      },
    ],
    contacts: [
      {
        id: "contact-1",
        clinic_id: "clinic-1",
        full_name: "Lead",
        phone_e164: "+6000000000",
        treatment_interest: null,
        current_status: "new_lead",
        source: null,
        campaign_name: null,
        bot_mode: "active",
        automation_enabled: true,
        next_follow_up_at: null,
        last_inbound_at: null,
        last_outbound_at: null,
        appointment_date: null,
        appointment_time: null,
        attendance_status: null,
        lead_memory_auto: {},
        lead_memory_override: {},
        staff_note: null,
        lead_memory_last_error: null,
        lead_memory_last_generated_at: null,
      },
    ],
    messages: [],
    contact_memory_runner_runs: [],
  });

  await withEnv(
    {
      OPENAI_API_KEY: null,
      LEAD_MEMORY_MODEL: null,
    },
    async () => {
      const summary = await runDueContactMemoryJobs({
        admin,
        clinicId: "clinic-1",
        triggerSource: "manual",
      });
      const job = admin.db.contact_memory_jobs[0];
      const contact = admin.db.contacts[0];

      assert.equal(summary.jobs_scanned, 1);
      assert.equal(summary.jobs_completed, 0);
      assert.equal(summary.jobs_failed, 0);
      assert.equal(summary.jobs_skipped, 1);
      assert.equal(job.status, "pending");
      assert.equal(job.attempt_count, 2);
      assert.ok(job.scheduled_for > new Date(now).toISOString());
      assert.match(
        contact.lead_memory_last_error,
        /OPENAI_API_KEY|LEAD_MEMORY_MODEL/
      );
    }
  );
});
