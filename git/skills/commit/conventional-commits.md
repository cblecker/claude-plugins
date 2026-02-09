# Conventional Commits Reference

**Format:** `<type>(<scope>): <description>`

| Type | Description |
|------|-------------|
| feat | New feature |
| fix | Bug fix |
| docs | Documentation |
| style | Code style (no logic change) |
| refactor | Code restructuring |
| revert | Revert a previous commit |
| perf | Performance improvement |
| test | Adding tests |
| chore | Maintenance |
| build | Build system changes |
| ci | CI/CD changes |

**Subject:** Imperative mood, lowercase, no period, max 50 chars

**Example:**

```text
feat(auth): add OAuth2 login support

Implements OAuth2 authentication with Google and GitHub providers.
Includes token refresh and session management.

Closes #123
```
