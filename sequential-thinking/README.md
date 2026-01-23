# Sequential Thinking Plugin

A Claude Code plugin that integrates the Model Context Protocol (MCP) sequential thinking server for dynamic, reflective problem-solving through structured chain-of-thought reasoning.

## Features

- **Problem Breakdown**: Decompose complex problems into manageable thinking steps
- **Dynamic Estimation**: Adjust the total number of thought steps as understanding deepens
- **Revision & Backtracking**: Question or revise previous thoughts when new insights emerge
- **Branching Paths**: Explore alternative approaches when appropriate
- **Hypothesis Generation**: Create and verify solution hypotheses iteratively
- **Context Filtering**: Ignore irrelevant information at each step
- **Adaptive Planning**: Extend thinking beyond initial estimates when needed

## Use Cases

Use the sequential thinking tool when you need to:

- Break down complex problems into steps
- Plan and design with room for revision
- Analyze situations that might need course correction
- Work through problems where the full scope isn't clear initially
- Develop multi-step solutions
- Maintain context over multiple reasoning steps
- Filter out irrelevant information systematically

## Tool Reference

The plugin provides the `sequentialthinking` tool with the following parameters:

### Required Parameters

- `thought` (string): Current thinking step, which can include:
  - Regular analytical steps
  - Revisions of previous thoughts
  - Questions about previous decisions
  - Realizations about needing more analysis
  - Changes in approach
  - Hypothesis generation
  - Hypothesis verification

- `nextThoughtNeeded` (boolean): Whether another thought step is needed

- `thoughtNumber` (integer): Current thought number in sequence (1-based)

- `totalThoughts` (integer): Current estimate of total thoughts needed (can be adjusted)

### Optional Parameters

- `isRevision` (boolean): Whether this thought revises previous thinking

- `revisesThought` (integer): Which thought number is being reconsidered (if `isRevision` is true)

- `branchFromThought` (integer): Thought number to branch from

- `branchId` (string): Identifier for the current branch

- `needsMoreThoughts` (boolean): Whether more thoughts are needed beyond initial estimate

## How It Works

The tool supports a flexible thinking process:

1. Start with an initial estimate of needed thoughts
2. Feel free to question or revise previous thoughts as you progress
3. Add more thoughts if needed, even when reaching the initial end
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Generate solution hypotheses when appropriate
7. Verify hypotheses based on the chain of thought
8. Repeat until a satisfactory solution is reached

The tool encourages adaptive, non-linear thinking rather than forcing a predetermined path.

## Links

- [Upstream Repository](https://github.com/modelcontextprotocol/servers)
- [NPM Package](https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking)
