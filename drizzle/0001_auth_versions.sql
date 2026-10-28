ALTER TABLE `members` ADD `auth_version` text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_version` text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
CREATE INDEX `session_member_auth_idx` ON `sessions` (`member_id`,`auth_version`);