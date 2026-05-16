ALTER TABLE "checkpoints" ADD COLUMN "memory_json" jsonb;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD COLUMN "policy_yaml" text;