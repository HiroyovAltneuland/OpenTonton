CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`dates` text NOT NULL,
	`duration` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`confirmed` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`terms_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_expiry_idx` ON `events` (`expires_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`nickname` text NOT NULL,
	`role` text NOT NULL,
	`password` text NOT NULL,
	`recovery` text NOT NULL,
	`availability` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`agreed_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_event_name_idx` ON `members` (`event_id`,`nickname`);--> statement-breakpoint
CREATE INDEX `members_event_idx` ON `members` (`event_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_expiry_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_expiry_idx` ON `sessions` (`expires_at`);
