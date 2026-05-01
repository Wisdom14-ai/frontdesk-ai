# AI Call Sites Discovery

Searches run:

- `openai.chat.completions.create`
- `new OpenAI(`
- `from "openai"` / `from 'openai'`
- `OPENAI_API_KEY`
- `api.openai.com`
- `fetch(OPENAI`

The codebase does not currently use the OpenAI Node SDK. There are no `new OpenAI(...)`, `from "openai"`, `from 'openai'`, or `openai.chat.completions.create` call sites. The actual OpenAI API calls are direct `fetch` requests to the Responses API.

| File path + line range | Function name | Purpose | `clinic_id` available in scope? | `contact_id` available in scope? | Suggested `operation_type` |
| --- | --- | --- | --- | --- | --- |
| `src/lib/server/contact-memory-ai.ts:235-361` | `callOpenAiResponses` | Generates structured lead memory JSON from clinic, contact, and recent message context. | Yes, `input.clinic.id`. | Yes, `input.contact.id`. | `lead_memory_generation` |
| `src/lib/server/whatsapp-chatbot.ts:338-481` | `generateChatbotDecision` | Generates an inbound WhatsApp bot decision and optional reply from clinic, contact, inbound message, and recent message context. | Yes, `input.clinic.id`. | Yes, `input.contact.id`. | `inbound_reply` |

`OPENAI_API_KEY` is read in:

- `src/lib/server/contact-memory-ai.ts` for lead memory AI configuration.
- `src/lib/server/whatsapp-chatbot.ts` for WhatsApp chatbot configuration.

No call sites require a clinic attribution refactor in the current codebase.
