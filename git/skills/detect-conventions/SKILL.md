---
name: detect-conventions
description: Detect if repository uses conventional commits format
user-invocable: false
context: fork
model: haiku
agent: Explore
---

# Detect Conventions

## Repository Context

- Commitlint config exists: !`test -f commitlint.config.js -o -f .commitlintrc -o -f .commitlintrc.json -o -f .commitlintrc.yml && echo "yes" || echo "no"`
- Package.json has commitlint: !`grep -q commitlint package.json 2>/dev/null && echo "yes" || echo "no"`
- Git hooks use commitlint: !`grep -q "commitlint\|conventional" .git/hooks/commit-msg 2>/dev/null && echo "yes" || echo "no"`
- Recent commits: !`git log -10 --pretty=format:"%s"`
- CLAUDE.md excerpt: !`grep -i "conventional\|commit" CLAUDE.md .claude/CLAUDE.md 2>/dev/null | head -5 || echo "no mentions"`

## Task

Analyze the repository context above and determine:

1. **Uses conventional commits?** (yes/no)
2. **Detection method:** config_file, history_analysis, or claude_md
3. **Confidence:** high (config exists), medium (60%+ commits match), low (unclear)
4. **Detected types in use:** List commit types seen (feat, fix, docs, etc.)

Output format:
```
USES_CONVENTIONAL_COMMITS: yes|no
DETECTION_METHOD: config_file|history_analysis|claude_md|none
CONFIDENCE: high|medium|low
TYPES_IN_USE: feat, fix, docs, ...
```
