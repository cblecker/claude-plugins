# rh-dataverse

Red Hat Dataverse MCP server with skills for querying enterprise data products.

## Components

### MCP Server

HTTP-based MCP server connected to `mcp.dataverse.redhat.com`. Authentication is
handled automatically via the `/mcp` command.

Available tools:

- `identify_dataproducts` -- identify relevant data products for a query
- `shortlist_tables` -- shortlist tables within a data product
- `get_sql` -- generate SQL from natural language
- `execute_sql` -- execute SQL against Snowflake

### Skills

| Skill | Description |
|-------|-------------|
| [rover-people](./skills/rover-people) | Look up Red Hat employees by name, email, or kerberos ID; find managers, direct reports, and org structure |
