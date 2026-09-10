#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const plugin = fileURLToPath(new URL('../..', import.meta.url));
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
try {
  const manifest = load(join(plugin, '.codex-plugin/plugin.json'));
  assert.equal(manifest.name, 'pr-review-toolkit');
  assert.equal(manifest.version, load(join(plugin, '.claude-plugin/plugin.json')).version);
  assert.equal(manifest.skills, './codex/skills/');
  assert.ok(manifest.interface.defaultPrompt.length);
  for (const path of ['codex/skills/review-pr/SKILL.md', 'codex/bin/prepare.mjs', 'codex/bin/codex-review-pr.bash'])
    assert.ok(existsSync(join(plugin, path)), `Missing ${path}`);
  const skills = join(plugin, 'codex/skills');
  for (const file of files(skills).filter(path => path.endsWith('.md'))) {
    const content = readFileSync(file, 'utf8');
    for (const [, target] of content.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(target)) continue;
      assert.ok(existsSync(resolve(dirname(file), target.split('#')[0])), `Broken reference in ${file}: ${target}`);
    }
  }
  console.log('Codex manifest, explicit skill root, and bundled references validated.');
  if (process.argv.includes('--install')) {
    const home = mkdtempSync(join(tmpdir(), 'codex-review-install-'));
    try {
      const cli = args => {
        const result = spawnSync('codex', args, { cwd: home, env: { ...process.env, CODEX_HOME: home },
          encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
        if (result.status !== 0) throw Error(result.stderr || result.error?.message || 'Codex command failed');
        return result.stdout;
      };
      cli(['plugin', 'marketplace', 'add', resolve(plugin, '..'), '--json']);
      const installed = JSON.parse(cli(['plugin', 'add', 'pr-review-toolkit@cblecker-claude-plugins', '--json']));
      assert.equal(installed.version, manifest.version);
      for (const file of files(join(plugin, 'codex'))) {
        const relative = file.slice(plugin.length);
        assert.equal(readFileSync(join(installed.installedPath, relative), 'utf8'), readFileSync(file, 'utf8'));
      }
      const prompt = cli(['debug', 'prompt-input', 'Validate skill discovery.']);
      assert.ok(prompt.includes('/codex/skills/review-pr/SKILL.md'));
      assert.ok(!prompt.includes('/skills/address-pr-feedback/SKILL.md'));
      console.log('Temporary local installation and exclusive Codex skill discovery verified.');
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
