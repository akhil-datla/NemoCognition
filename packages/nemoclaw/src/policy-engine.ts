import type { ActionType } from "@nemocognition/core";

export type PolicyDecision = "allow" | "deny";

export interface PolicyRule {
  id: string;
  actionType: ActionType;
  /** Human-readable pattern, kept in the trace for explainability. */
  pattern: string;
  /** Pure predicate against the resource string. Built from the pattern via the helpers below. */
  matches: (resource: string) => boolean;
  decision: PolicyDecision;
  reason: string;
}

export interface PolicyConfig {
  rules: PolicyRule[];
  defaultDecision: Partial<Record<ActionType, PolicyDecision>>;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  ruleId: string;
  ruleText: string;
  policyPath: string;
  normalizedResource: string;
  reason: string;
}

export function evaluatePolicy(
  actionType: ActionType,
  resource: string,
  config: PolicyConfig,
): PolicyEvaluation {
  for (let i = 0; i < config.rules.length; i++) {
    const rule = config.rules[i];
    if (rule.actionType !== actionType) continue;
    if (!rule.matches(resource)) continue;
    return {
      decision: rule.decision,
      ruleId: rule.id,
      ruleText: `${rule.decision}: ${rule.pattern}`,
      policyPath: `rules[${i}]`,
      normalizedResource: resource,
      reason: rule.reason,
    };
  }
  const fallback = config.defaultDecision[actionType] ?? "allow";
  return {
    decision: fallback,
    ruleId: `default_${actionType}`,
    ruleText: `default: ${fallback}`,
    policyPath: `defaultDecision.${actionType}`,
    normalizedResource: resource,
    reason: `No matching rule; default ${fallback}`,
  };
}

export function globMatcher(pattern: string): (s: string) => boolean {
  const re = globToRegExp(pattern);
  return (s) => re.test(s);
}

export function prefixMatcher(prefix: string): (s: string) => boolean {
  return (s) => s.startsWith(prefix);
}

export function regexMatcher(source: string, flags?: string): (s: string) => boolean {
  const re = new RegExp(source, flags);
  return (s) => re.test(s);
}

function globToRegExp(pattern: string): RegExp {
  // Reserve placeholders for **/, ** and *, escape regex metachars, then substitute.
  // `**/` matches zero-or-more path segments (so `**/foo` matches both `foo` and `a/foo`).
  let p = pattern
    .replace(/\*\*\//g, "\x00GS\x00")
    .replace(/\*\*/g, "\x00G\x00")
    .replace(/\*/g, "\x00S\x00");
  p = p.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");
  p = p
    .replace(/\x00GS\x00/g, "(?:.*/)?")
    .replace(/\x00G\x00/g, ".*")
    .replace(/\x00S\x00/g, "[^/]*");
  return new RegExp("^" + p + "$");
}

// Matches actual dotenv-secret files: `.env`, `.env.local`, `.env.production`,
// `.env.development`, `.env.test`, `.env.staging`, `.env.dev`, `.env.prod`
// — anywhere in the tree. Does NOT match committed templates like
// `.env.example`, `.env.template`, `.env.sample`, which agents need to be
// able to read AND write as the canonical recovery path when the real
// `.env` is denied.
const DOTENV_SECRET_PATTERN =
  "(^|/)\\.env(\\.(local|development|production|test|staging|dev|prod))?$";

export const DEFAULT_POLICY: PolicyConfig = {
  rules: [
    {
      id: "deny_dotenv_read",
      actionType: "file_read",
      pattern: DOTENV_SECRET_PATTERN,
      matches: regexMatcher(DOTENV_SECRET_PATTERN),
      decision: "deny",
      reason: "Environment files may contain secrets (read .env.example for templates instead)",
    },
    {
      id: "deny_credentials_read",
      actionType: "file_read",
      pattern: "**/credentials*",
      matches: globMatcher("**/credentials*"),
      decision: "deny",
      reason: "Credential files are sensitive",
    },
    {
      id: "deny_git_read",
      actionType: "file_read",
      pattern: ".git/**",
      matches: globMatcher(".git/**"),
      decision: "deny",
      reason: "Git internals are not part of the working tree",
    },
    {
      id: "deny_dotenv_write",
      actionType: "file_write",
      pattern: DOTENV_SECRET_PATTERN,
      matches: regexMatcher(DOTENV_SECRET_PATTERN),
      decision: "deny",
      reason: "Environment files must not be overwritten by the agent (write .env.example as a template instead)",
    },
    {
      id: "deny_git_write",
      actionType: "file_write",
      pattern: ".git/**",
      matches: globMatcher(".git/**"),
      decision: "deny",
      reason: "Git internals must not be modified",
    },
    {
      id: "deny_node_modules_write",
      actionType: "file_write",
      pattern: "**/node_modules/**",
      matches: globMatcher("**/node_modules/**"),
      decision: "deny",
      reason: "node_modules is managed by the package manager",
    },
    {
      id: "deny_next_build_write",
      actionType: "file_write",
      pattern: "**/.next/**",
      matches: globMatcher("**/.next/**"),
      decision: "deny",
      reason: "Build output must not be hand-edited",
    },
    {
      id: "deny_sudo",
      actionType: "command_execution",
      pattern: "^sudo( |$)",
      matches: regexMatcher("^sudo( |$)"),
      decision: "deny",
      reason: "Privilege escalation is not permitted",
    },
    {
      id: "deny_rm_rf_root",
      actionType: "command_execution",
      pattern: "rm -rf /",
      matches: regexMatcher("rm\\s+-rf?\\s+/(\\s|$)"),
      decision: "deny",
      reason: "Recursive root deletion is not permitted",
    },
    {
      id: "deny_sandbox_escape",
      actionType: "sandbox_boundary",
      pattern: "*",
      matches: () => true,
      decision: "deny",
      reason: "Path resolves outside the sandbox root",
    },
  ],
  defaultDecision: {
    file_read: "allow",
    file_write: "allow",
    command_execution: "allow",
    network_call: "allow",
    tool_execution: "allow",
    env_access: "deny",
    sandbox_boundary: "deny",
  },
};
