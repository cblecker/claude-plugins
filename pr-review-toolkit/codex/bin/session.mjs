#!/usr/bin/env node
import { createSession, cleanupSession } from '../lib/session.mjs';

try {
  const [action, sessionDir, source] = process.argv.slice(2);
  if (action === 'create' && process.argv.length === 3) console.log(createSession());
  else if (action === 'cleanup' && process.argv.length === 5 && sessionDir && source)
    cleanupSession(sessionDir, { cwd: source });
  else throw Error('Usage: session.mjs create | cleanup SESSION_DIR SOURCE');
} catch (error) { console.error(error.message); process.exitCode = 1; }
