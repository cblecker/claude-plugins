// `truncated` is set when the host cut stdout (`$.process.run` keeps 4 MiB per stream): output that
// must be complete (a diff read as a file list) is unusable then.
export type ProcResult = { exitCode: number; stdout: string; stderr: string; truncated?: boolean }
export type McpResult = { isError?: boolean; content?: { type: string; text?: string }[] }
export type CompleteRequest = { model: string; system: string; prompt: string; maxTokens: number; effort?: string; timeoutMs?: number }
export type CompleteResult = { isAnswered: boolean; text: string }
export type Io = {
  run(argv: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<ProcResult>
  mcp(tool: string, args: Record<string, unknown>): Promise<McpResult>
  complete(req: CompleteRequest): Promise<CompleteResult>
}
