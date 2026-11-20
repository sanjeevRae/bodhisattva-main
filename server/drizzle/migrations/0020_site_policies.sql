-- 0020_site_policies (2026-11-20)
-- Owner feature: the footer policy pages (Privacy Policy, Terms of
-- Use, Accessibility) become real pages whose content admins edit in
-- the rich text editor. Plan reviewed by ChatGPT thinking mode
-- (8/10; amendments adopted: revision history, optimistic
-- concurrency, dedicated policy sanitizer).
--  1. site_policies: exactly three rows, enforced by the
--     chk_policies_slug CHECK constraint + the API allowlist + no
--     create/delete endpoints. `version` is the optimistic-
--     concurrency counter (an update must name the loaded version).
--  2. site_policy_revisions: every save snapshots the PREVIOUS
--     content here, in the same transaction as the update + audit
--     row, so any earlier version can be viewed and restored.
--  3. The policy.manage permission + its ADMIN grant (idempotent).
--     SUPER_ADMIN holds every permission by construction.
--  4. Starter content for the three pages (INSERT IGNORE: re-running
--     this migration NEVER overwrites content an admin has edited).
--     The starter text describes only what this website actually
--     does today and is flagged in the admin UI for legal review.
-- The drizzle-generated snapshot (meta/0020_snapshot.json) is kept;
-- the generated SQL needed no drift removal this time.
-- Seed parity: seed-data/permissions.ts (PERMISSIONS + ADMIN list).

CREATE TABLE `site_policies` (
	`slug` varchar(40) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body_html` longtext NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`updated_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_policies_slug` PRIMARY KEY(`slug`),
	CONSTRAINT `chk_policies_slug` CHECK(`site_policies`.`slug` IN ('privacy-policy', 'terms-of-use', 'accessibility'))
);
--> statement-breakpoint
CREATE TABLE `site_policy_revisions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(40) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body_html` longtext NOT NULL,
	`version` int unsigned NOT NULL,
	`saved_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_policy_revisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_policies` ADD CONSTRAINT `fk_policies_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `site_policy_revisions` ADD CONSTRAINT `fk_policy_revisions_slug` FOREIGN KEY (`slug`) REFERENCES `site_policies`(`slug`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `site_policy_revisions` ADD CONSTRAINT `fk_policy_revisions_saved_by` FOREIGN KEY (`saved_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_policy_revisions_slug` ON `site_policy_revisions` (`slug`,`id`);
--> statement-breakpoint
INSERT IGNORE INTO `permissions` (`code`, `description`) VALUES ('policy.manage', 'Manage the legal policy pages (privacy, terms, accessibility)');
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p
WHERE r.`code` = 'ADMIN' AND p.`code` = 'policy.manage';
--> statement-breakpoint
INSERT IGNORE INTO `site_policies` (`slug`, `title`, `body_html`) VALUES ('privacy-policy', 'Privacy Policy', '<h2>Who we are</h2><p>Bodhisattva International operates this website for Bodhisattva Gallery and the Purna Museum of Newa Art, House No. 91, Diamond Marg, Kupondole, Lalitpur, Nepal. This policy explains what personal information the website collects and how it is used.</p><h2>Information we collect</h2><p><strong>Account information.</strong> When you register, we collect your name, email address and phone number. Your password is stored only as a secure hash; we never store it in readable form.</p><p><strong>Orders.</strong> When you place an order in the Gift Shop, we collect the delivery name, phone number and address, and a record of what you ordered. Payment is cash on delivery, so we never collect or store card or bank details.</p><p><strong>Contact form.</strong> When you send us a message through the contact form, we collect your name, email address, subject and message so that we can reply to you.</p><p><strong>Technical information.</strong> Our servers keep standard logs, such as IP address and browser type, for security and troubleshooting.</p><h2>How we use your information</h2><ul><li>To provide and manage your account.</li><li>To process and deliver your orders, and to send order emails including your invoice.</li><li>To respond to messages you send us.</li><li>To keep the website secure and working properly.</li></ul><h2>Cookies</h2><p>This website uses cookies that are needed for it to work, such as keeping you signed in and remembering your shopping cart. We do not use advertising or analytics trackers.</p><h2>Sharing your information</h2><p>We share delivery details (name, phone number and address) with the people who deliver your order, so that your parcel can reach you. Order and account emails are sent through our own mail server. We do not sell personal information.</p><h2>How long we keep information</h2><p>We keep account and order records for as long as your account is active and as needed for our own records and legal obligations. Contact messages are kept so that we can follow up with you.</p><h2>Your choices</h2><p>You may ask us to correct or delete your personal information, or to close your account, by contacting us using the details below. We will respond within a reasonable time.</p><h2>Changes to this policy</h2><p>If we change this policy, the new version will be published on this page together with its update date.</p><h2>Contact us</h2><p>Email: info@bodhisattvainternational.com<br>Phone: +977 981-8882876</p>');
--> statement-breakpoint
INSERT IGNORE INTO `site_policies` (`slug`, `title`, `body_html`) VALUES ('terms-of-use', 'Terms of Use', '<h2>Using this website</h2><p>By using this website you agree to these terms. If you do not agree with them, please do not use the website.</p><h2>Your account</h2><p>You are responsible for the accuracy of the details you register with, and for keeping your password confidential. Please tell us promptly if you believe your account has been used without your permission.</p><h2>Gift Shop orders</h2><p>An order is an offer to buy. We confirm orders by email and may contact you by phone to confirm the details before dispatch. We may decline or cancel an order, for example when an item is out of stock; if that happens, we will let you know.</p><h2>Prices and payment</h2><p>Prices are shown in Nepalese Rupees (NPR). Delivery charges and VAT, where they apply, are shown at checkout before you confirm your order. Payment is cash on delivery unless we agree otherwise with you in advance.</p><h2>Delivery, cancellations and returns</h2><p>You may cancel an order before it is dispatched by contacting us. If something you receive is damaged, or is not what you ordered, please contact us promptly and we will work with you to put it right.</p><h2>Intellectual property</h2><p>The text, images and artwork shown on this website belong to Bodhisattva International, the artists, or their respective owners. Please do not copy or reuse them without written permission.</p><h2>Acceptable use</h2><ul><li>Do not use this website for anything unlawful.</li><li>Do not try to break, bypass or test the security of the website.</li><li>Do not submit misleading or harmful content through any form on the website.</li></ul><h2>Accuracy and availability</h2><p>We work to keep the information on this website accurate and the website available, but we cannot guarantee that it will always be complete or uninterrupted.</p><h2>Changes to these terms</h2><p>If we change these terms, the new version will be published on this page together with its update date. Continuing to use the website after a change means you accept the updated terms.</p><h2>Contact us</h2><p>Email: info@bodhisattvainternational.com<br>Phone: +977 981-8882876</p>');
--> statement-breakpoint
INSERT IGNORE INTO `site_policies` (`slug`, `title`, `body_html`) VALUES ('accessibility', 'Accessibility', '<h2>Our commitment</h2><p>We want everyone to be able to use this website, including visitors who rely on assistive technology. We treat accessibility as ongoing work, not a finished state.</p><h2>What we do</h2><ul><li>Pages are built with a clear structure and headings, so they can be navigated in order.</li><li>Images carry alternative text where they add information.</li><li>Controls such as buttons, links and forms can be reached and used with a keyboard.</li><li>We take care that text is readable against its background.</li></ul><h2>Known limitations</h2><p>Some older material, such as scanned newspaper clippings in the press archive, is provided as images or PDF scans and may not be fully readable with a screen reader. Where we know about a problem, we are working to improve it.</p><h2>Tell us about a problem</h2><p>If you have difficulty using any part of this website, please contact us at info@bodhisattvainternational.com or +977 981-8882876 and tell us what you were trying to do. We will do our best to provide the information in another way and to fix the problem.</p>');