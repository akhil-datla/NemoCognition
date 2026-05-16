import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  globMatcher,
  prefixMatcher,
  regexMatcher,
  DEFAULT_POLICY,
  type PolicyConfig,
} from "./policy-engine";

describe("globMatcher", () => {
  it("matches single segments with *", () => {
    const m = globMatcher("src/*.ts");
    expect(m("src/foo.ts")).toBe(true);
    expect(m("src/bar/foo.ts")).toBe(false);
  });
  it("matches any depth with **", () => {
    const m = globMatcher("src/**/foo.ts");
    expect(m("src/foo.ts")).toBe(true);
    expect(m("src/a/b/foo.ts")).toBe(true);
    expect(m("other/foo.ts")).toBe(false);
  });
  it("matches dotfile patterns", () => {
    const m = globMatcher("**/.env*");
    expect(m(".env")).toBe(true);
    expect(m(".env.local")).toBe(true);
    expect(m("apps/web/.env.local")).toBe(true);
    expect(m("README.md")).toBe(false);
  });
});

describe("prefixMatcher", () => {
  it("matches strings starting with prefix", () => {
    expect(prefixMatcher("sudo ")("sudo apt install")).toBe(true);
    expect(prefixMatcher("sudo ")("ls -la")).toBe(false);
  });
});

describe("regexMatcher", () => {
  it("matches arbitrary regex sources", () => {
    expect(regexMatcher("^sudo( |$)")("sudo")).toBe(true);
    expect(regexMatcher("^sudo( |$)")("sudo ls")).toBe(true);
    expect(regexMatcher("^sudo( |$)")("pseudoephedrine")).toBe(false);
  });
});

describe("evaluatePolicy", () => {
  const config: PolicyConfig = {
    rules: [
      {
        id: "deny_private",
        actionType: "file_read",
        pattern: "private/**",
        matches: globMatcher("private/**"),
        decision: "deny",
        reason: "private dir",
      },
      {
        id: "allow_research",
        actionType: "file_read",
        pattern: "research/**",
        matches: globMatcher("research/**"),
        decision: "allow",
        reason: "research is fine",
      },
    ],
    defaultDecision: { file_read: "deny" },
  };

  it("returns the first matching rule", () => {
    const result = evaluatePolicy("file_read", "private/secret.txt", config);
    expect(result.decision).toBe("deny");
    expect(result.ruleId).toBe("deny_private");
    expect(result.policyPath).toBe("rules[0]");
    expect(result.normalizedResource).toBe("private/secret.txt");
  });

  it("returns an allow when an allow-rule matches first", () => {
    const result = evaluatePolicy("file_read", "research/paper.md", config);
    expect(result.decision).toBe("allow");
    expect(result.ruleId).toBe("allow_research");
  });

  it("falls back to defaultDecision when no rule matches", () => {
    const result = evaluatePolicy("file_read", "elsewhere/foo.md", config);
    expect(result.decision).toBe("deny");
    expect(result.ruleId).toBe("default_file_read");
    expect(result.policyPath).toBe("defaultDecision.file_read");
  });

  it("falls back to allow when defaultDecision is missing for the action", () => {
    const result = evaluatePolicy("network_call", "https://example.com", config);
    expect(result.decision).toBe("allow");
  });

  it("rules for a different actionType are ignored", () => {
    const result = evaluatePolicy("file_write", "private/secret.txt", config);
    expect(result.decision).toBe("allow");
    expect(result.ruleId).toBe("default_file_write");
  });
});

describe("DEFAULT_POLICY", () => {
  it("denies reading dotenv files anywhere in the tree", () => {
    expect(evaluatePolicy("file_read", ".env", DEFAULT_POLICY).decision).toBe("deny");
    expect(evaluatePolicy("file_read", "apps/web/.env.local", DEFAULT_POLICY).decision).toBe(
      "deny",
    );
  });
  it("allows reading regular source files by default", () => {
    expect(evaluatePolicy("file_read", "apps/web/src/lib/foo.ts", DEFAULT_POLICY).decision).toBe(
      "allow",
    );
  });
  it("denies writing to .git, .next, node_modules", () => {
    expect(evaluatePolicy("file_write", ".git/config", DEFAULT_POLICY).decision).toBe("deny");
    expect(evaluatePolicy("file_write", "apps/web/.next/foo", DEFAULT_POLICY).decision).toBe(
      "deny",
    );
    expect(evaluatePolicy("file_write", "node_modules/pkg/x.js", DEFAULT_POLICY).decision).toBe(
      "deny",
    );
  });
  it("denies sudo and rm -rf /", () => {
    expect(evaluatePolicy("command_execution", "sudo apt install", DEFAULT_POLICY).decision).toBe(
      "deny",
    );
    expect(evaluatePolicy("command_execution", "rm -rf /", DEFAULT_POLICY).decision).toBe("deny");
    expect(evaluatePolicy("command_execution", "rm -rf /tmp/foo", DEFAULT_POLICY).decision).toBe(
      "allow",
    );
  });
  it("denies anything tagged as a sandbox boundary violation", () => {
    expect(
      evaluatePolicy("sandbox_boundary", "/etc/passwd", DEFAULT_POLICY).decision,
    ).toBe("deny");
  });
});
