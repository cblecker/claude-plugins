---
name: rover-people
description: >-
  Look up Red Hat employees by name or email, find managers and direct reports,
  and query org charts using the rh-dataverse MCP pipeline.
when_to_use: >-
  "look up someone in rover", "find a Red Hat employee", "who is [person]'s
  manager", "who reports to [person]", "show org chart for [person]"
allowed-tools: mcp__plugin_rh-dataverse_rh-dataverse__shortlist_tables, mcp__plugin_rh-dataverse_rh-dataverse__get_sql, mcp__plugin_rh-dataverse_rh-dataverse__execute_sql
---

# Rover People Lookup

Look up Red Hat employees, managers, direct reports, and organizational
structure using the rh-dataverse MCP server's query pipeline.

## Pipeline

Every query follows a 3-step pipeline. Do not skip steps or call tools out of
order.

```text
shortlist_tables -> get_sql -> execute_sql
```

### Step 1: Shortlist Tables

Call `shortlist_tables` with:

- `data_product`: `"RoverPeople"`
- `user_query`: the user's original query

Pass the shortlisted tables directly to Step 2.

### Step 2: Generate SQL

Call `get_sql` with:

- `data_product`: `"RoverPeople"`
- `tables_list`: the shortlisted tables from Step 1
- `user_query`: the user's original query

Do not modify the generated SQL.

### Step 3: Execute SQL

Call `execute_sql` with the SQL returned from Step 2.

## Formatting Results

Present single-person results as a card (name, email, title, manager, geo,
cost center). Present multi-person results as a markdown table. Present org
chart results as an indented hierarchy.

## Important Notes

- Always use the full pipeline. Do not write SQL directly or call `execute_sql`
  without first generating SQL through `get_sql`.
- `ROVER_PEOPLE_CURR` only contains current employees.
- If the query is ambiguous (e.g., a common name), present all matches and ask
  the user to clarify.
