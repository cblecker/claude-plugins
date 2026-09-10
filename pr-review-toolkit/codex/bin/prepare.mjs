#!/usr/bin/env node
import { prepare } from '../lib/prepare.mjs';
try {
  if (process.argv.length !== 3) throw Error('Usage: prepare.mjs GITHUB_PR_URL');
  const result = prepare(process.argv[2]);
  console.error(`Review checkout: ${result.checkoutPath}\nStartup context: ${result.contextFile}`);
  // NUL-delimited arguments avoid eval and preserve spaces in filesystem paths.
  process.stdout.write([result.checkoutPath, result.contextFile].join('\0') + '\0');
} catch (error) { console.error(error.message); process.exitCode = 1; }
