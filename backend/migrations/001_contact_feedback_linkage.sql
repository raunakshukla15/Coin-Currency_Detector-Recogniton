-- Migration 001: link Contact Us feedback to accounts + add idempotency key.
-- Run ONCE against an EXISTING database (fresh installs get this from schema.sql):
--     mysql -u <user> -p coinscan < backend/migrations/001_contact_feedback_linkage.sql
-- Existing contact_messages rows are preserved (user_id stays NULL = unattributed).

ALTER TABLE contact_messages
  ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN submission_id VARCHAR(36) NULL AFTER message,
  ADD CONSTRAINT fk_contact_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD UNIQUE KEY uq_contact_submission (submission_id),
  ADD INDEX idx_contact_user_created (user_id, created_at);
