import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(name) {
  try {
    const raw = readFileSync(join(here, "..", name), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // Optional.
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const clinicIdArg = readArg("clinic-id");
const extraSelfNames = [
  ...readRepeatedArg("self-name"),
  ...(process.env.CONTACT_NAME_CLEANUP_SELF_NAMES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];

const GENERIC_CONTACT_NAME_KEYS = new Set([
  "business",
  "businessaccount",
  "clinic",
  "contact",
  "customer",
  "lead",
  "me",
  "mybusiness",
  "null",
  "patient",
  "prospect",
  "undefined",
  "unknown",
  "user",
  "whatsapp",
]);

function readArg(name) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readRepeatedArg(name) {
  const prefix = `--${name}=`;
  return args
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length).trim())
    .filter(Boolean);
}

function normalizePhoneNumber(input) {
  let digitsOnly = input.replace(/\D/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.startsWith("00")) digitsOnly = digitsOnly.slice(2);
  if (digitsOnly.startsWith("60")) return `+${digitsOnly}`;
  if (digitsOnly.startsWith("0")) return `+60${digitsOnly.slice(1)}`;
  return `+${digitsOnly}`;
}

function normalizeIdentity(value) {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function isPhoneLikeName(name, phone) {
  const nameDigits = name.replace(/\D/g, "");
  const phoneDigits = phone?.replace(/\D/g, "") ?? "";
  if (phoneDigits && nameDigits === phoneDigits) return true;

  const normalizedPhone = normalizePhoneNumber(phone ?? "");
  return Boolean(normalizedPhone && normalizePhoneNumber(name) === normalizedPhone);
}

function matchesSelfIdentity(nameKey, selfNames) {
  for (const selfName of selfNames) {
    const selfKey = normalizeIdentity(selfName);
    if (!selfKey) continue;
    if (nameKey === selfKey) return true;
    if (
      nameKey.length >= 8 &&
      selfKey.length >= 8 &&
      (nameKey.startsWith(selfKey) || selfKey.startsWith(nameKey))
    ) {
      return true;
    }
  }
  return false;
}

function shouldCleanName(input) {
  const name = input.name?.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!name || name.length < 2 || name.length > 80) return true;
  if (!/[\p{L}\p{N}]/u.test(name)) return true;
  if (isPhoneLikeName(name, input.phone)) return true;
  if (/@s\.whatsapp\.net|@c\.us|@g\.us/i.test(name)) return true;

  const nameKey = normalizeIdentity(name);
  if (nameKey && GENERIC_CONTACT_NAME_KEYS.has(nameKey)) return true;
  return Boolean(nameKey && matchesSelfIdentity(nameKey, input.selfNames));
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchClinics(supabase) {
  let query = supabase
    .from("clinics")
    .select("id, name, evolution_instance_name")
    .order("created_at", { ascending: true });

  if (clinicIdArg) {
    query = query.eq("id", clinicIdArg);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function cleanupClinic(supabase, clinic) {
  const selfNames = [clinic.name, clinic.evolution_instance_name, ...extraSelfNames];
  const batchSize = 500;
  let from = 0;
  let scanned = 0;
  let cleaned = 0;
  const samples = [];

  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, full_name, phone_e164, source")
      .eq("clinic_id", clinic.id)
      .range(from, from + batchSize - 1);

    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const contact of rows) {
      scanned += 1;
      const replacement = contact.phone_e164?.trim();
      if (!replacement) continue;

      if (
        shouldCleanName({
          name: contact.full_name,
          phone: contact.phone_e164,
          selfNames,
        }) &&
        contact.full_name !== replacement
      ) {
        cleaned += 1;
        if (samples.length < 20) {
          samples.push({
            id: contact.id,
            from: contact.full_name,
            to: replacement,
            source: contact.source,
          });
        }

        if (apply) {
          const { error: updateError } = await supabase
            .from("contacts")
            .update({
              full_name: replacement,
              updated_at: new Date().toISOString(),
            })
            .eq("id", contact.id)
            .eq("clinic_id", clinic.id);

          if (updateError) throw updateError;
        }
      }
    }

    if (rows.length < batchSize) break;
    from += batchSize;
  }

  return { scanned, cleaned, samples };
}

async function main() {
  const supabase = getSupabaseClient();
  const clinics = await fetchClinics(supabase);

  let scannedTotal = 0;
  let cleanedTotal = 0;
  for (const clinic of clinics) {
    const result = await cleanupClinic(supabase, clinic);
    scannedTotal += result.scanned;
    cleanedTotal += result.cleaned;
    console.log(
      `${apply ? "Updated" : "Would update"} ${result.cleaned} of ${result.scanned} contacts for ${clinic.name} (${clinic.id}).`
    );
    for (const sample of result.samples) {
      console.log(`  - ${sample.id}: "${sample.from}" -> "${sample.to}"`);
    }
  }

  console.log(
    `${apply ? "Done." : "Dry run only."} ${cleanedTotal} of ${scannedTotal} contacts matched cleanup rules.`
  );
  if (!apply) {
    console.log("Run again with --apply to write changes.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
