// Eyeball test for the AI follow-up generator.
//
// Sends realistic sample transcripts (mirroring the WhatsApp screenshots)
// through the SAME prompt the app uses, so you can see the generated
// follow-up immediately instead of waiting for a live 48h automation job.
//
// The key check: the stored name fields below are deliberately WRONG
// (contact_name = your own company, clinic_name = a person). A correct
// result must ignore them and use the names from the transcript instead.
//
// Run:  node scripts/test-followup.mjs
// Needs OPENAI_API_KEY and a model env (WHATSAPP_CHATBOT_MODEL /
// CHATBOT_MODEL / LEAD_MEMORY_MODEL) in .env.local or .env.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
    // file optional
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const model = (
  process.env.WHATSAPP_CHATBOT_MODEL ||
  process.env.CHATBOT_MODEL ||
  process.env.LEAD_MEMORY_MODEL ||
  ""
).trim();

if (!apiKey || !model) {
  console.error(
    "Missing OPENAI_API_KEY or model env (WHATSAPP_CHATBOT_MODEL / CHATBOT_MODEL / LEAD_MEMORY_MODEL)."
  );
  process.exit(1);
}

// MUST stay in sync with buildFollowUpSystemPrompt() in
// src/lib/server/whatsapp-chatbot.ts
const SYSTEM_PROMPT = [
  "You are writing ONE WhatsApp follow-up message on behalf of the same sender who has been messaging in the conversation below.",
  "The recipient has NOT replied to the previous message(s). Your job is a short, natural nudge to re-engage them.",
  "Read the transcript carefully and CONTINUE that same conversation. Do not restart it, change the topic, change the offer, or change the persona.",
  "Match the language of the transcript exactly (e.g. English, Malay, Chinese). If earlier messages were bilingual, mirror that.",
  "Address the recipient the same way they were addressed earlier in the thread — use the business or person name actually used in the transcript. NEVER address the recipient by the sender's own name or company.",
  "Refer to the sender (person and company) exactly as already established earlier in the thread. Keep the sender identity 100% consistent with earlier messages — do not invent or change names.",
  "Keep the same intent and direction as the original outreach. If the thread is a B2B pitch (e.g. asking to be passed to the owner/decision-maker), continue that. Do NOT switch to a generic 'help you book an appointment' script unless the thread was genuinely about booking an appointment.",
  "The structured name fields in the user payload may be unreliable or swapped — when they conflict with the transcript, ALWAYS trust the transcript.",
  "Be brief (under 55 words), polite, low-pressure. No spammy urgency, no new emojis unless the thread already used them.",
  "Output ONLY the message text to send. No quotes, no labels, no explanation.",
].join("\n");

const scenarios = [
  {
    label: "EN B2B — Klinik GPOSH (stored names deliberately wrong)",
    follow_up_stage: "no_reply_day_2",
    weak_hints: {
      sender_org_name: "Shafiq Haris",
      recipient_name: "Belthar Intelligence",
      sender_style_guide: null,
    },
    transcript: [
      { direction: "outbound", sender_type: "human", content: "Hi Klinik GPOSH" },
      {
        direction: "outbound",
        sender_type: "human",
        content:
          "This is Shafiq from Belthar Intelligence. I help dental clinics increase new patient inflow and average monthly sales more consistently — without squeezing profit margins or relying on expensive hires. If possible, could you kindly pass this to the owner or doctor who handles marketing? I'm happy to share one quick observation here first.",
      },
    ],
  },
  {
    label: "MS B2B — Klinik MyFamily (Malay thread)",
    follow_up_stage: "no_reply_day_2",
    weak_hints: {
      sender_org_name: "Shafiq Haris",
      recipient_name: "Belthar Intelligence",
      sender_style_guide: null,
    },
    transcript: [
      {
        direction: "outbound",
        sender_type: "human",
        content: "Hi Klinik MyFamily Gelang Patah",
      },
      {
        direction: "outbound",
        sender_type: "human",
        content:
          "Saya Shafiq dari Belthar Intelligence. Saya bantu dental clinics tingkatkan pesakit baru dan sales bulanan dengan lebih konsisten — tanpa turunkan margin dan tanpa perlu hire staff mahal. Kalau sesuai, boleh pass mesej ni pada owner atau doktor yang handle marketing?",
      },
    ],
  },
  {
    label: "ZH reply — Reverse Aging (recipient replied in Chinese)",
    follow_up_stage: "no_reply_day_2",
    weak_hints: {
      sender_org_name: "Shafiq Haris",
      recipient_name: "Belthar Intelligence",
      sender_style_guide: null,
    },
    transcript: [
      {
        direction: "outbound",
        sender_type: "human",
        content:
          "This is Shafiq from Belthar Intelligence. I help clinics increase new patient inflow. Could you kindly pass this to the owner who handles marketing?",
      },
      {
        direction: "inbound",
        sender_type: "lead",
        content:
          "你好~ 感谢您的询问~ 我是你专属Consultant - Abby。亲爱的，为了更快更精准资料，可以先跟我们说一说你比较想了解哪一项？",
      },
    ],
  },
];

async function run(scenario) {
  const body = {
    model,
    store: false,
    input: [
      { role: "developer", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          note: "Name fields below are weak hints only and may be swapped. The transcript is the source of truth for who the sender and recipient are.",
          follow_up_stage: scenario.follow_up_stage,
          weak_hints: scenario.weak_hints,
          transcript_oldest_first: scenario.transcript,
        }),
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return `  [ERROR ${res.status}] ${json?.error?.message ?? "request failed"}`;
  }

  let text = json?.output_text;
  if (!text && Array.isArray(json?.output)) {
    text = json.output
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text)
      .find((t) => t && t.trim());
  }
  return "  " + (text?.trim() ?? "(no output)").replace(/\n/g, "\n  ");
}

for (const scenario of scenarios) {
  console.log("\n=== " + scenario.label + " ===");
  console.log(await run(scenario));
}
console.log("");
