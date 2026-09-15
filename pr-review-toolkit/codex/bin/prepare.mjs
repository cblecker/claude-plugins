#!/usr/bin/env node
import { prepare } from '../lib/prepare.mjs';
try {
  if (process.argv.length !== 4) throw Error('Usage: prepare.mjs GITHUB_PR_URL SESSION_DIR');
  const result = prepare(process.argv[2], { sessionDir: process.argv[3] });
  console.error(`Review checkout: ${result.checkoutPath}\nStartup context: ${result.contextFile}`);
  // NUL-delimited arguments avoid eval and preserve spaces in filesystem paths.
  process.stdout.write([result.checkoutPath, result.contextFile].join('\0') + '\0');
} catch (error) { console.error(error.message); process.exitCode = 1; }
