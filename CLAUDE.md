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

- **Session** (`src/session.ts`): Wraps Claude CLI as PTY subprocess. Two modes: `runPrompt(prompt)` for one-shot execution, `startInteractive()` for persistent terminal. Emits `output`, `terminal`, `message`, `completion`, `exit`, `idle`, `working` events. Maintains terminal buffer for reconnections. Includes buffer management for long-running sessions (12-24+ hours) with automatic trimming.

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
// msg.type: 'system' | 'assistant' | 'user' | 'result'
// msg.message?.content: Array<{ type: 'text', text: string }>
// msg.total_cost_usd: number (on result messages)
```

### PTY Spawn Modes

**One-shot mode** (prompt execution):
```typescript
pty.spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], { ... })
```

**Interactive mode** (persistent terminal):
```typescript
pty.spawn('claude', ['--dangerously-skip-permissions'], { ... })
```

### Idle Detection

Session detects idle by watching for prompt character (`❯` or `\u276f`) and waiting 2 seconds without activity. RespawnController uses the same patterns plus spinner characters to detect working state.

### Long-Running Session Support

Sessions are optimized for 12-24+ hour runs with automatic buffer management:

**Buffer Limits:**
- Terminal buffer: 5MB max, trims to 4MB when exceeded
- Text output: 2MB max, trims to 1.5MB when exceeded
- Messages: 1000 max, keeps most recent 800 when exceeded

**Performance Optimizations:**
- Server-side terminal batching at 60fps (16ms intervals)
- Client-side requestAnimationFrame batching for smooth rendering
- Buffer statistics available via session details for monitoring

**Buffer Stats Response:**
```typescript
{
  bufferStats: {
    terminalBufferSize: number;  // Current terminal buffer size in bytes
    textOutputSize: number;      // Current text output size in bytes
    messageCount: number;        // Number of parsed messages
    maxTerminalBuffer: number;   // Max allowed terminal buffer
    maxTextOutput: number;       // Max allowed text output
    maxMessages: number;         // Max allowed messages
  }
}
```

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
| `session:created` | `{ session }` | New session created |
| `session:deleted` | `{ id }` | Session removed |
| `session:output` | `{ id, data }` | Parsed output line (ANSI stripped) |
| `session:terminal` | `{ id, data }` | Raw terminal data with ANSI codes |
| `session:message` | `{ id, message }` | Parsed Claude JSON message |
| `session:running` | `{ id, prompt }` | Prompt execution started |
| `session:interactive` | `{ id }` | Interactive mode started |
| `session:completion` | `{ id, result, cost }` | Prompt completed, includes cost |
| `session:exit` | `{ id, code }` | Session process exited |
| `session:idle` | `{ id }` | Session is idle (prompt detected) |
| `session:working` | `{ id }` | Session is working (activity detected) |
| `session:updated` | `{ session }` | Session state updated |
| `session:error` | `{ id, error }` | Session error occurred |

**Respawn Controller Events:**
| Event | Data | Description |
|-------|------|-------------|
| `respawn:started` | `{ sessionId, status }` | Respawn controller started |
| `respawn:stopped` | `{ sessionId }` | Respawn controller stopped |
| `respawn:stateChanged` | `{ sessionId, state, prevState }` | State machine transition |
| `respawn:cycleStarted` | `{ sessionId, cycleNumber }` | New update cycle starting |
| `respawn:cycleCompleted` | `{ sessionId, cycleNumber }` | Update cycle finished |
| `respawn:stepSent` | `{ sessionId, step, input }` | Command sent (update/clear/init) |
| `respawn:stepCompleted` | `{ sessionId, step }` | Command completed |
| `respawn:configUpdated` | `{ sessionId, config }` | Configuration changed |
| `respawn:log` | `{ sessionId, message }` | Debug/info log message |
| `respawn:error` | `{ sessionId, error }` | Error occurred |

**Scheduled Run Events:**
| Event | Data | Description |
|-------|------|-------------|
| `scheduled:created` | `{ run }` | New scheduled run created |
| `scheduled:updated` | `{ run }` | Status/timer update |
| `scheduled:log` | `{ id, log }` | Scheduled run log entry |
| `scheduled:completed` | `{ run }` | Scheduled run finished |
| `scheduled:stopped` | `{ run }` | Scheduled run stopped by user |

**Case Events:**
| Event | Data | Description |
|-------|------|-------------|
| `case:created` | `{ name, path }` | New case directory created |

**Init Event:**
| Event | Data | Description |
|-------|------|-------------|
| `init` | `{ sessions, scheduledRuns, respawnStatus, timestamp }` | Full state sent on SSE connection |

## API Endpoints

### Session Management

```
GET  /api/sessions                    # List all sessions (includes buffer stats)
POST /api/sessions                    # Create session { workingDir }
GET  /api/sessions/:id                # Get single session details
DELETE /api/sessions/:id              # Stop and remove a session (kills process + children)
DELETE /api/sessions                  # Kill all sessions at once
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

### Cases & Quick Start

```
GET  /api/cases                       # List case directories
POST /api/cases                       # Create case { name, description }
GET  /api/cases/:name                 # Get case details
POST /api/quick-start                 # Quick start { caseName? } - creates case + interactive session
POST /api/run                         # Quick run { prompt, workingDir } (no session management)
```

**Quick Start Response:**
```typescript
{
  success: boolean;
  sessionId?: string;    // ID of the created session
  casePath?: string;     // Full path to the case directory
  caseName?: string;     // Name of the case
  error?: string;        // Error message if success is false
}
```

### Events

```
GET  /api/events                      # SSE stream (real-time events)
GET  /api/status                      # Full state snapshot (sessions + scheduled + respawn)
```

