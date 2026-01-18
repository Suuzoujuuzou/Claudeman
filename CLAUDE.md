# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudeman is a Claude Code session manager with a web interface and autonomous Ralph Loop. It spawns Claude CLI processes via PTY, streams output in real-time via SSE, and supports scheduled/timed runs.

**Tech Stack**: TypeScript, Node.js, Fastify, Server-Sent Events, node-pty

## Commands

```bash
npm run build          # Compile TypeScript + copy static files to dist/web/
npm run dev            # Run with tsx (no build needed)
npm run clean          # Remove dist/

npm link               # Make 'claudeman' globally available
claudeman web          # Start web interface on port 3000
claudeman web -p 8080  # Custom port
```

## Architecture

```
src/
├── index.ts              # CLI entry point (commander)
├── cli.ts                # CLI command implementations
├── session.ts            # Core: PTY wrapper for Claude CLI
├── session-manager.ts    # Manages multiple sessions
├── respawn-controller.ts # Auto-respawn state machine
├── ralph-loop.ts         # Autonomous task assignment
├── task.ts / task-queue.ts # Priority queue with dependencies
├── state-store.ts        # Persistence to ~/.claudeman/state.json
├── types.ts              # All TypeScript interfaces
├── web/
│   ├── server.ts         # Fastify REST API + SSE
│   └── public/           # Static frontend files
└── templates/
    └── claude-md.ts      # CLAUDE.md generator for new cases
```

### Data Flow

1. **Session** spawns `claude -p --dangerously-skip-permissions` via `node-pty`
2. PTY output is buffered, ANSI stripped, and parsed for JSON messages
3. **WebServer** broadcasts events to SSE clients at `/api/events`
4. State persists to `~/.claudeman/state.json` via **StateStore**

### Key Components

- **Session** (`src/session.ts`): Wraps Claude CLI as PTY subprocess. Two modes: `runPrompt(prompt)` for one-shot execution, `startInteractive()` for persistent terminal. Emits `output`, `terminal`, `message`, `completion`, `exit`, `idle`, `working` events. Maintains terminal buffer for reconnections.

- **RespawnController** (`src/respawn-controller.ts`): State machine that keeps interactive sessions productive. Detects idle → sends update prompt → `/clear` → `/init` → repeats. Configurable timeouts and prompts.

- **RalphLoop** (`src/ralph-loop.ts`): Autonomous task assignment controller. Monitors sessions for idle state, assigns tasks from queue, detects completion via `<promise>PHRASE</promise>` markers. Supports time-aware loops with minimum duration.

- **WebServer** (`src/web/server.ts`): Fastify server with REST API + SSE. Manages sessions, scheduled runs, respawn controllers, and case directories. Broadcasts all events to connected clients.

### Session Modes

**One-Shot Mode** (`runPrompt(prompt)`):
- Execute a single prompt and receive completion event
- Used for scheduled runs and quick API calls
- Session exits after prompt completes

**Interactive Mode** (`startInteractive()`):
- Persistent PTY terminal with full Claude CLI access
- Supports terminal resize for proper formatting
- Terminal buffer persisted for client reconnections
- Works with RespawnController for autonomous cycling

## Code Patterns

### Claude Message Parsing

Claude CLI outputs newline-delimited JSON. Strip ANSI codes before parsing:

```typescript
const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
const msg = JSON.parse(cleanLine) as ClaudeMessage;
// msg.type: 'system' | 'assistant' | 'result'
// msg.message?.content: Array<{ type: 'text', text: string }>
// msg.total_cost_usd: number (on result messages)
```

### Idle Detection

Session detects idle by watching for prompt character (`❯` or `\u276f`) and waiting 2 seconds without activity. RespawnController uses the same patterns plus spinner characters to detect working state.

### Respawn Controller State Machine

```
WATCHING → SENDING_UPDATE → WAITING_UPDATE → SENDING_CLEAR → WAITING_CLEAR → SENDING_INIT → WAITING_INIT → WATCHING
```

Default config (`RespawnConfig` in `src/types.ts`):
- `idleTimeoutMs`: 5000 (5s after prompt)
- `updatePrompt`: "update all the docs and CLAUDE.md"
- `interStepDelayMs`: 1000 (1s between steps)

### SSE Event Catalog

All events are broadcast to clients connected to `/api/events`. Event format: `{ type: string, sessionId?: string, data: any }`.

**Session Events:**
| Event | Data | Description |
|-------|------|-------------|
| `session:output` | `{ text, raw }` | Parsed output line (ANSI stripped) |
| `session:terminal` | `{ data }` | Raw terminal data with ANSI codes |
| `session:message` | `{ message }` | Parsed Claude JSON message |
| `session:completion` | `{ cost }` | Prompt completed, includes cost |
| `session:exit` | `{ code }` | Session process exited |
| `session:idle` | `{}` | Session is idle (prompt detected) |
| `session:working` | `{}` | Session is working (activity detected) |

**Respawn Controller Events:**
| Event | Data | Description |
|-------|------|-------------|
| `respawn:stateChanged` | `{ from, to }` | State machine transition |
| `respawn:cycleStarted` | `{ cycleNumber }` | New update cycle starting |
| `respawn:cycleCompleted` | `{ cycleNumber }` | Update cycle finished |
| `respawn:stepSent` | `{ step }` | Command sent (update/clear/init) |
| `respawn:stepCompleted` | `{ step }` | Command completed |
| `respawn:log` | `{ message, level }` | Debug/info log message |

**Scheduled Run Events:**
| Event | Data | Description |
|-------|------|-------------|
| `scheduled:created` | `{ id, prompt, duration }` | New scheduled run created |
| `scheduled:updated` | `{ id, status, remaining }` | Status/timer update |
| `scheduled:log` | `{ id, message }` | Scheduled run log entry |
| `scheduled:completed` | `{ id, success }` | Scheduled run finished |

## API Endpoints

### Session Management

```
GET  /api/sessions                    # List all sessions
POST /api/sessions                    # Create session { workingDir }
GET  /api/sessions/:id                # Get single session details
DELETE /api/sessions/:id              # Stop and remove a session
GET  /api/sessions/:id/output         # Get session output buffer
GET  /api/sessions/:id/terminal       # Get terminal buffer (raw ANSI)
```

### Session Operations

```
POST /api/sessions/:id/run            # Run prompt { prompt } (one-shot mode)
POST /api/sessions/:id/interactive    # Start interactive terminal mode
POST /api/sessions/:id/input          # Send input to interactive session { input }
POST /api/sessions/:id/resize         # Resize terminal { cols, rows }
POST /api/sessions/:id/interactive-respawn  # Start interactive + respawn controller
```

### Respawn Controller

```
GET  /api/sessions/:id/respawn        # Get respawn controller state
POST /api/sessions/:id/respawn/start  # Start respawn controller { config? }
POST /api/sessions/:id/respawn/stop   # Stop respawn controller
PUT  /api/sessions/:id/respawn/config # Update config { idleTimeoutMs, updatePrompt, interStepDelayMs }
```

### Scheduled Runs

```
GET  /api/scheduled                   # List all scheduled runs
POST /api/scheduled                   # Create { prompt, workingDir, durationMinutes }
GET  /api/scheduled/:id               # Get scheduled run details
DELETE /api/scheduled/:id             # Cancel scheduled run
```

### Cases & Quick Run

```
GET  /api/cases                       # List case directories
POST /api/cases                       # Create case { name, description }
GET  /api/cases/:name                 # Get case details
POST /api/run                         # Quick run { prompt, workingDir } (no session management)
```

### Events

```
GET  /api/events                      # SSE stream (real-time events)
GET  /api/status                      # Full state snapshot (sessions + scheduled + respawn)
```

## Session Log

| Date | Tasks Completed | Files Changed | Notes |
|------|-----------------|---------------|-------|
| 2026-01-18 | Initial implementation | All files | Core CLI + web interface |
| 2026-01-18 | Add web interface | src/web/* | Fastify + SSE + responsive UI |
| 2026-01-18 | Add RespawnController | src/respawn-controller.ts, src/web/server.ts, src/types.ts | Auto-respawn loop with state machine |
| 2026-01-18 | Update documentation | CLAUDE.md, README.md | Full API docs (20 endpoints), SSE event catalog, interactive terminal docs, respawn controller docs |
