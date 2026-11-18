-- Migration 0012 — About-page contact form submissions (spec: Secure
-- About Us Contact Form + SMTP Email Integration, Phase 7).
--
-- `contact_submissions` persists every accepted website contact message
-- BEFORE the email is attempted, so a submission is never lost to an
-- SMTP outage: the row records the delivery outcome honestly —
--   RECEIVED  persisted, send not yet completed (transient)
--   SENT      the mailer accepted the message (email_message_id stored)
--   FAILED    the mailer rejected/failed the send (visitor got a 503)
-- "Delivered" is never claimed: SMTP acceptance is the strongest signal
-- the platform has. The CMS seed has anticipated this table since
-- Phase 4 (seed-data/cms-content.ts, ContactFormConfig: "Submissions
-- persist to contact_submissions").
--
-- Hand-written per DATABASE_DESIGN.md §13.1, following 0011's pattern:
--   1. CREATE TABLE carries the design §2.1 table options
--      ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci.
--   2. No existing table or row is touched.
-- Rollback: 0012_contact_submissions_down.sql (same folder).
CREATE TABLE `contact_submissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80) NOT NULL,
	`email` varchar(254) NOT NULL,
	`subject` varchar(120) NOT NULL,
	`message` text NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'RECEIVED',
	`email_message_id` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `contact_submissions_id` PRIMARY KEY(`id`),
	INDEX `idx_contact_submissions_created` (`created_at`),
	INDEX `idx_contact_submissions_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
