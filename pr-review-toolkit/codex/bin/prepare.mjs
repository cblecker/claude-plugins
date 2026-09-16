#!/usr/bin/env node
import { prepare } from '../lib/prepare.mjs';
try {
  if (process.argv.length !== 3) throw Error('Usage: prepare.mjs GITHUB_PR_URL');
  process.stdout.write(JSON.stringify(prepare(process.argv[2])) + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
