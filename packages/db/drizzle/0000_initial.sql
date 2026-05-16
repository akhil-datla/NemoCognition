CREATE TYPE "public"."branch_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('success', 'failure', 'risky', 'memory', 'branch');--> statement-breakpoint
CREATE TYPE "public"."policy_decision" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."span_kind" AS ENUM('agent', 'llm', 'tool', 'chain', 'event');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('pass', 'fail', 'risky');--> statement-breakpoint
CREATE TYPE "public"."video_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"parent_branch_id" text,
	"fork_node_id" text,
	"status" "branch_status" DEFAULT 'running' NOT NULL,
	"correction_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"memory_ref" text,
	"context_ref" text,
	"prompt_ref" text,
	"diff_ref" text,
	"file_tree_hash_ref" text,
	"env_ref" text,
	"policy_ref" text,
	"policy_resolved_ref" text,
	"audit_window_ref" text,
	"validation_ref" text,
	"parent_checkpoint_id" text,
	"phoenix_trace_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"parent_id" text,
	"type" text NOT NULL,
	"status" "node_status" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"timestamp_start" timestamp with time zone NOT NULL,
	"timestamp_end" timestamp with time zone,
	"payload_ref" text,
	"checkpoint_ref" text,
	"validation_ref" text
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"node_id" text NOT NULL,
	"parent_node_id" text,
	"checkpoint_id" text,
	"action_type" text NOT NULL,
	"decision" "policy_decision" NOT NULL,
	"resource" text NOT NULL,
	"normalized_resource" text NOT NULL,
	"policy_rule_id" text NOT NULL,
	"policy_rule_text" text NOT NULL,
	"policy_path" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"audit_log_ref" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"raw_payload_ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"user_task" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"root_branch_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_span_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"phoenix_span_id" text NOT NULL,
	"span_kind" "span_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" "validation_status" NOT NULL,
	"failure_category" text,
	"policy_failure_category" text,
	"confidence" real NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"recommended_fix" text
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"status" "video_job_status" DEFAULT 'pending' NOT NULL,
	"input_trace_ref" text NOT NULL,
	"output_video_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_nodes" ADD CONSTRAINT "execution_nodes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_span_refs" ADD CONSTRAINT "trace_span_refs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;