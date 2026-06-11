-- Adds the structured clinic knowledge base used by the WhatsApp AI chatbot.
-- Run this in the Supabase SQL editor for the production project.
-- Safe to run multiple times.
alter table clinics add column if not exists clinic_knowledge text;
