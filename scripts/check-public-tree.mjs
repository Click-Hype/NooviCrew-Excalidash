#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const files = output.split("\0").filter(Boolean);
const findings = [];

const add = (file, rule) => findings.push({ file, rule });

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";

  if (segments.some((part) => [".claude", ".codex", ".agents"].includes(part))) {
    add(file, "local-agent-config-directory");
  }
  if (["AGENTS.md", "ROADMAP-NOOVICREW.md", "NOOVICREW.md"].includes(basename)) {
    add(file, "private-workspace-instructions");
  }
  if (/^(claude_desktop_config\.json|\.mcp\.json|\.git-credentials)$/i.test(basename)) {
    add(file, "local-client-configuration");
  }
  if (/\.(?:db|sqlite)(?:\..*)?$/i.test(basename) || /\.(?:pem|key|p12|pfx)$/i.test(basename)) {
    add(file, "sensitive-binary-or-key-material");
  }
  if (/^\.env(?:\.|$)/.test(basename) && !/example$/.test(basename) && normalized !== "frontend/.env.production") {
    add(file, "environment-file");
  }
  if (["dashboard.png", "adminDashboard.png", "migrationScreen.png", "scoped.png"].includes(basename)) {
    add(file, "known-private-screenshot");
  }

  let stat;
  try {
    stat = statSync(path.join(root, file));
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;

  const buffer = readFileSync(path.join(root, file));
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  const contentRules = [
    [/(?:^|["'`\s])\/home\/[\w.-]+\//m, "absolute-linux-home"],
    [/(?:^|["'`\s])\/Users\/[\w.-]+\//m, "absolute-macos-home"],
    [/(?:^|\/)\.[\w.-]+\/excalidash(?:\/|\.env|\b)/i, "private-config-directory"],
    [/https?:\/\/map\./i, "private-map-endpoint"],
  ];
  for (const [pattern, rule] of contentRules) {
    if (pattern.test(text)) add(file, rule);
  }

  const allowedEmailDomains = new Set([
    "example.com",
    "example.test",
    "evil.com",
    "github.com",
    "test.com",
    "users.noreply.github.com",
  ]);
  for (const match of text.matchAll(/[\w.+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const domain = match[1].toLowerCase();
    if (!allowedEmailDomains.has(domain) && !domain.endsWith(".local")) {
      add(file, "non-example-email-address");
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Public-tree policy failed. Only paths and rule names are shown:");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.rule}`);
  }
  process.exit(1);
}

console.log(`Public-tree policy passed (${files.length} tracked files checked).`);
