# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

- **Project Name**: Claudeman
- **Description**: Claude Code session manager with web interface and autonomous Ralph Loop
- **Tech Stack**: TypeScript, Node.js, Fastify, Server-Sent Events
- **Last Updated**: 2026-01-18

## Architecture

```
claudeman/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── cli.ts             # Commander.js CLI commands
│   ├── types.ts           # TypeScript type definitions
│   ├── session.ts         # Claude CLI subprocess wrapper
│   ├── session-manager.ts # Session registry and lifecycle
│   ├── task.ts            # Task definitions
│   ├── task-queue.ts      # Priority queue with dependencies
│   ├── ralph-loop.ts      # Autonomous loop controller
│   ├── state-store.ts     # JSON persistence (~/.claudeman/state.json)
│   └── web/
│       ├── server.ts      # Fastify server with SSE
│       └── public/        # Static frontend files
│           ├── index.html
│           ├── styles.css
│           └── app.js
├── dist/                  # Compiled output
├── package.json
└── tsconfig.json
```

## Key Commands

```bash
# Development
npm run build          # Compile TypeScript + copy static files
npm run dev            # Run with tsx (no build needed)

# Usage
claudeman web          # Start web interface on port 3000
claudeman web -p 8080  # Custom port

# CLI commands
claudeman status       # Show overall status
claudeman task add "<prompt>" --priority N
claudeman ralph start --min-hours 4
```

## How It Works

1. **Session**: Wraps `claude -p --output-format stream-json` subprocess
2. **Web Server**: Fastify serves static files + REST API + SSE for real-time
3. **Timed Runs**: Loop that repeatedly runs prompts until duration expires
4. **State**: Persisted to `~/.claudeman/state.json`

## Code Patterns

### Session JSON Parsing
Claude CLI outputs newline-delimited JSON with types: `system`, `assistant`, `result`
```typescript
// Parse streaming JSON lines
const msg = JSON.parse(line) as ClaudeMessage;
if (msg.type === 'assistant' && msg.message?.content) {
  // Extract text from content blocks
}
```

### SSE Broadcasting
```typescript
private broadcast(event: string, data: unknown): void {
  for (const client of this.sseClients) {
    client.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
```

## Work Principles

- Full permissions granted via `.claude/settings.json`
- Commit after every meaningful change
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`

## Session Log

| Date | Tasks Completed | Files Changed | Notes |
|------|-----------------|---------------|-------|
| 2026-01-18 | Initial implementation | All files | Core CLI + web interface |
| 2026-01-18 | Add web interface | src/web/* | Fastify + SSE + responsive UI |
