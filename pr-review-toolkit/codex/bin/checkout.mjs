#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { checkout } from '../lib/checkout.mjs';

try {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--verify'))
    throw Error('Usage: checkout.mjs [--verify] < context.json');
  const result = checkout(JSON.parse(readFileSync(0, 'utf8')), { verifyOnly: process.argv[2] === '--verify' });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  console.error(`Checkout ${process.cwd()}: ${error.message}`);
  process.exitCode = 1;
}
