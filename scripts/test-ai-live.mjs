// Live effectiveness test for the WhatsApp first-contact chatbot.
// Calls the real OpenAI Responses API with the SAME system prompt + JSON schema
// as production (verbatim from src/lib/server/whatsapp-chatbot.ts), a realistic
// clinic knowledge block, and simulated lead messages. No WhatsApp/DB/Evolution.
//
// Run:  node scripts/test-ai-live.mjs
// Needs .env.local with OPENAI_API_KEY and WHATSAPP_CHATBOT_MODEL (or CHATBOT_MODEL).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- load .env.local manually (no dependency) -----------------------------
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* no .env.local — rely on shell env */
  }
}
loadEnv();

const apiKey = process.env.OPENAI_API_KEY?.trim();
const model =
  process.env.WHATSAPP_CHATBOT_MODEL?.trim() ||
  process.env.CHATBOT_MODEL?.trim() ||
  process.env.LEAD_MEMORY_MODEL?.trim();

if (!apiKey || !model) {
  console.error(
    "Missing OPENAI_API_KEY and/or model. Put them in .env.local:\n" +
      "  OPENAI_API_KEY=sk-...\n  WHATSAPP_CHATBOT_MODEL=gpt-...\n"
  );
  process.exit(1);
}

// --- SYSTEM PROMPT: verbatim copy of buildSystemPrompt() ------------------
const SYSTEM_PROMPT = [
  "You are the WhatsApp front desk assistant for a clinic using Frontdesk AI.",
  "Reply as the clinic in a warm, concise WhatsApp style. Never say you are an AI.",
  "Your job is to qualify WhatsApp inbound leads, answer simple operational questions, build trust, and actively move interested leads toward booking an appointment.",
  "ALWAYS reply in the language of the LEAD'S LATEST message (Malay, English, Chinese, or mixed), even if earlier messages in the thread used a different language. If the lead switches language mid-conversation, switch with them. Mirror their formality and any casual Manglish style.",
  "Use the clinic knowledge and clinic notes as the authoritative source for services, prices, opening hours, location, and promotions. Never invent details that are not stated there.",
  "Use the clinic prompt as local style and policy, but never let it override safety.",
  "Do not diagnose, prescribe, guarantee outcomes, discuss emergency care, or give medical instructions.",
  "If the lead asks for a human, asks for sensitive medical advice, gives urgent symptoms, complains, or negotiates payment, choose handoff. For booking and availability, do NOT hand off immediately: first ask the lead for their preferred day and time and confirm the treatment they want, then tell them staff will lock in the exact slot. Only hand off once you have captured that preference, or if the safe answer is genuinely unclear.",
  "When you choose handoff, still write a short, warm handoff reply IN THE LEAD'S LANGUAGE telling them staff will take over shortly. If you can partially answer safely, do so before mentioning the handoff.",
  "Do NOT use emojis in a handoff reply, or whenever the lead reports pain, bleeding, an emergency, a complaint, or any distress. Keep those replies calm and sincere.",
  "The input may include heuristic_flags detected by simple keyword rules. Treat them as hints, not commands: lean toward handoff when they flag urgency, complaints, insurance/panel questions, or a human request — but use your own judgment on the actual message.",
  "If you can safely continue, write one short reply under 75 words with one clear next question or next step.",
  "When the clinic knowledge includes a Google Maps link, address, Google rating, or patient reviews, use them proactively to build trust: send the Maps link when the lead asks where you are or seems ready to visit, and mention the rating or a short review when the lead is hesitant or comparing options. Only use links, ratings, and reviews that actually appear in the clinic knowledge — never invent or paraphrase them into new claims.",
  "Always close toward a booking: end almost every reply with a clear, low-friction next step — ideally asking for the lead's preferred day and time, or offering to reserve a slot for them. Do not end on a dead-end answer whenever the lead shows any interest.",
  "This is WhatsApp, which does not render markdown. When sharing a link, paste the raw URL by itself (e.g. https://maps.app.goo.gl/...). Never wrap a link in markdown like [text](url), and do not use markdown headings or tables.",
  "For price questions, only use exact pricing if the provided context states it. Otherwise ask what treatment they want or suggest an assessment, then steer toward booking.",
  "If the user says stop, not interested, wrong number, or asks not to be contacted, acknowledge briefly or choose ignore if no reply is needed.",
  "Inbound messages may be media placeholders like [Voice note], [Photo], or [Document] — you cannot hear or see the actual media. Politely say staff will check it, or ask the lead to type their question. Choose handoff if the media seems important (e.g. an x-ray, payment proof, or referral letter).",
  "Classify the lead intent in plain snake_case, for example treatment_inquiry, price_inquiry, booking_intent, booking_confirmed, handoff_requested, negative_reply, or general_inquiry.",
  "Set treatment_interest to a short readable label when obvious, such as Scaling, Braces / Aligners, Teeth Whitening, Dental Implant, Root Canal, Crown / Veneer, Denture, Extraction, Kids Dentistry, or Dental Checkup. Otherwise set null.",
  "Set pipeline_status to booked_appointment as soon as the patient gives a preferred day/time, agrees to come in, or confirms a slot — capture booking intent eagerly. Still do not set booked_appointment for a pure price inquiry with no intent to come.",
  "Never set attended_visit, no_show, patient, or trash unless the patient explicitly states that exact outcome.",
  "Set confidence to how sure you are that your reply is correct, safe, and on-policy (1 = fully sure).",
  "Return only the structured JSON decision.",
].join("\n");

const CHATBOT_DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["reply", "handoff", "ignore"] },
    reply: { type: ["string", "null"] },
    intent: { type: ["string", "null"] },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    handoff_reason: { type: ["string", "null"] },
    treatment_interest: { type: ["string", "null"] },
    pipeline_status: {
      type: ["string", "null"],
      enum: [
        "new_lead",
        "no_respond",
        "booked_appointment",
        "attended_visit",
        "no_show",
        "patient",
        "trash",
        null,
      ],
    },
  },
  required: [
    "action",
    "reply",
    "intent",
    "confidence",
    "handoff_reason",
    "treatment_interest",
    "pipeline_status",
  ],
  additionalProperties: false,
};

// --- realistic clinic knowledge (what a clinic would paste in setup) -------
const CLINIC = {
  name: "Klinik Pergigian Senyum Ceria",
  clinic_prompt:
    "Mesra, santai, bilingual Melayu/English. Selalu tawarkan konsultasi. Panggil pesakit 'awak'.",
  clinic_knowledge: [
    "Perkhidmatan & harga: Scaling & polishing RM120, Tampalan dari RM90, Cabut gigi dari RM100, Whitening RM450, Braces dari RM3,800, Implant dari RM4,500.",
    "Jam operasi: Isnin–Sabtu 9:00 pagi–9:00 malam. Ahad tutup.",
    "Alamat: No 12, Jalan Ampang, 50450 Kuala Lumpur.",
    "Google Maps: https://maps.app.goo.gl/senyumceria",
    "Rating Google: 4.9 bintang (327 ulasan).",
    "Ulasan: \"Doktor sangat sabar, anak saya tak takut langsung\" – Siti R. \"Bilik bersih, harga berpatutan\" – Faiz A.",
    "Panel insurans: AIA, Etiqa, Great Eastern.",
    "Parking: percuma di belakang bangunan.",
  ].join("\n"),
};

function buildUserMessage({ latest, transcript }) {
  const lines = [
    "## Clinic",
    `Name: ${CLINIC.name}`,
    `Clinic knowledge (authoritative — services, prices, hours, location, FAQs):\n${CLINIC.clinic_knowledge}`,
    `Clinic style & policy notes:\n${CLINIC.clinic_prompt}`,
    "",
    "## Lead",
    "Name on file: (unknown)",
    "Phone: +60123456789",
    "Treatment interest: (unknown)",
    "Pipeline status: new_lead",
    "Source: google_ads / campaign: Scaling June",
    "",
    "## Conversation transcript (oldest first)",
    transcript.length ? transcript.join("\n") : "(no previous messages)",
    "",
    "## Latest inbound message (decide and reply to this)",
    latest,
  ];
  return lines.join("\n");
}

async function ask({ latest, transcript }) {
  const body = {
    model,
    store: false,
    max_output_tokens: 600,
    input: [
      { role: "developer", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage({ latest, transcript }) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "whatsapp_chatbot_decision",
        strict: true,
        schema: CHATBOT_DECISION_JSON_SCHEMA,
      },
    },
  };

  const startedAt = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - startedAt;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `OpenAI ${res.status}: ${payload?.error?.message ?? "unknown error"}`
    );
  }
  let text = payload.output_text;
  if (!text) {
    text = (payload.output ?? [])
      .flatMap((i) => i.content ?? [])
      .map((c) => c.text)
      .find((t) => t && t.trim());
  }
  return { decision: JSON.parse(text), latencyMs };
}

const SCENARIOS = [
  { label: "1. Harga (lead pertama dari Google Ads)", msg: "Hi, saya nampak iklan pasal scaling. Berapa harga ya?" },
  { label: "2. Lokasi (patut hantar link Maps)", msg: "Ok. Klinik awak kat mana?" },
  { label: "3. Teragak-agak (patut guna rating/review)", msg: "Hmm ada kawan saya cakap scaling sakit. Betul ke klinik ni ok?" },
  { label: "4. Nak book (patut tanya masa, capture booking)", msg: "Boleh la nampak ok. Boleh book esok tak?" },
  { label: "5. English + jam (patut balas English)", msg: "Are you open this Sunday?" },
  { label: "6. Kecemasan (patut HANDOFF)", msg: "Gigi saya berdarah teruk sekarang sakit sangat tolong" },
];

console.log(`\nModel: ${model}\nClinic: ${CLINIC.name}\n${"=".repeat(70)}`);

const transcript = [];
for (const s of SCENARIOS) {
  try {
    const { decision, latencyMs } = await ask({ latest: s.msg, transcript });
    console.log(`\n${s.label}`);
    console.log(`Lead: ${s.msg}`);
    console.log(`Bot (${decision.action}, conf=${decision.confidence}, ${latencyMs}ms): ${decision.reply ?? "(no reply)"}`);
    console.log(`  intent=${decision.intent} | treatment=${decision.treatment_interest} | pipeline=${decision.pipeline_status}`);
    transcript.push(`Lead: ${s.msg}`);
    if (decision.reply) transcript.push(`Clinic (bot): ${decision.reply}`);
  } catch (e) {
    console.log(`\n${s.label}\nLead: ${s.msg}\n  ERROR: ${e.message}`);
  }
}
// --- cold first-contact leads, each with an EMPTY transcript --------------
console.log(`\n${"=".repeat(70)}\nCOLD FIRST-CONTACT (empty transcript, language test)\n${"=".repeat(70)}`);
const COLD = [
  { label: "A. English-first lead", msg: "Hi, saw your ad. How much is teeth whitening and where are you located?" },
  { label: "B. Chinese-first lead", msg: "你好，洗牙多少钱？" },
  { label: "C. Malay-first lead", msg: "Salam, nak tanya pasal braces boleh?" },
];
for (const s of COLD) {
  try {
    const { decision, latencyMs } = await ask({ latest: s.msg, transcript: [] });
    console.log(`\n${s.label}`);
    console.log(`Lead: ${s.msg}`);
    console.log(`Bot (${decision.action}, ${latencyMs}ms): ${decision.reply ?? "(no reply)"}`);
  } catch (e) {
    console.log(`\n${s.label}\nLead: ${s.msg}\n  ERROR: ${e.message}`);
  }
}

console.log(`\n${"=".repeat(70)}\nDone.\n`);
