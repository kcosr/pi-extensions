#!/usr/bin/env node
/**
 * Drain CLI
 *
 * Reads events from the fallback JSONL file, resends to HTTP collector,
 * and removes successfully sent events.
 *
 * Usage: npx tsx drain.ts
 */

import fs from "node:fs";
import { loadConfig } from "./lib.js";

async function drain() {
  const config = loadConfig();
  const logPath = config.file.path;
  const httpUrl = config.http.url;

  if (!fs.existsSync(logPath)) {
    console.log(`No fallback log found at ${logPath}`);
    return;
  }

  const content = fs.readFileSync(logPath, "utf-8").trim();
  if (!content) {
    console.log("No events to drain");
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  console.log(`Draining ${lines.length} events to ${httpUrl}...`);

  const failed: string[] = [];
  let sent = 0;

  for (const line of lines) {
    try {
      const res = await fetch(httpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: line,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      sent++;
      process.stdout.write(".");
    } catch (err) {
      process.stdout.write("x");
      failed.push(line);
    }
  }

  console.log(); // newline

  if (failed.length === 0) {
    fs.unlinkSync(logPath);
    console.log(`Done. All ${sent} events sent. Fallback log deleted.`);
  } else {
    fs.writeFileSync(logPath, failed.join("\n") + "\n");
    console.log(`Done. ${sent} sent, ${failed.length} still pending in ${logPath}`);
  }
}

drain().catch((err) => {
  console.error("Drain failed:", err);
  process.exit(1);
});
