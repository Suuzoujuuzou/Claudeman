# Claudeman

A Claude Code session manager with an autonomous Ralph Loop for task assignment and monitoring.

## Features

- **Web Interface**: Beautiful, responsive web UI with interactive terminal powered by xterm.js
- **Session Management**: Spawn and manage multiple Claude CLI sessions as PTY subprocesses
- **Interactive Terminal**: Full terminal access with resize support and buffer persistence for reconnections
- **Respawn Controller**: Autonomous state machine that cycles sessions (update docs → /clear → /init) with configurable prompts
- **Timed Runs**: Schedule Claude to work for a specific duration with live countdown
- **Real-time Output**: Stream Claude's responses in real-time via Server-Sent Events (21 event types)
- **Task Queue**: Priority-based task queue with dependency support
- **Ralph Loop**: Autonomous control loop that assigns tasks to idle sessions and monitors completion
- **Time-Aware Loops**: Extended work sessions with auto-generated follow-up tasks when minimum duration not reached
- **Case Management**: Create project workspaces with auto-generated CLAUDE.md templates
- **Cost Tracking**: Track total API costs across all sessions
- **State Persistence**: All state persisted to `~/.claudeman/state.json`

## Installation

```bash
npm install
npm run build
npm link  # Optional: make 'claudeman' available globally
```

## Quick Start

### Web Interface (Recommended)

```bash
# Start the web interface
claudeman web

# Open http://localhost:3000 in your browser
```

The web interface provides:
- **Interactive Terminal**: Full xterm.js terminal with resize support
- **Prompt Input**: Enter prompts and optionally set a working directory
- **Duration Timer**: Set duration in minutes for timed runs (0 = single run)
- **Live Output**: See Claude's response in real-time as it streams
- **Countdown**: Large timer display when running timed jobs
- **Session Monitoring**: View all active sessions with status indicators
- **Respawn Controls**: Start/stop respawn controller with configurable settings
- **Case Management**: Create new project workspaces with CLAUDE.md templates

### CLI Usage

```bash
# Start a Claude session
claudeman start --dir /path/to/project

# Add tasks to the queue
claudeman task add "Fix the bug in auth.ts"
claudeman task add "Add tests for the API" --priority 5

# Start the Ralph loop to process tasks
claudeman ralph start

# Check status
claudeman status
```

## Commands

### Web Interface

```bash
# Start web interface on default port (3000)
claudeman web

# Use a different port
claudeman web --port 8080
```

### Session Management

```bash
# Start a new session
claudeman session start [--dir <path>]
claudeman start [--dir <path>]  # shorthand

# Stop a session
claudeman session stop <session-id>

# List sessions
claudeman session list
claudeman list  # shorthand

# View session output
claudeman session logs <session-id>
claudeman session logs <session-id> --errors  # stderr
```

### Task Management

```bash
# Add a task
claudeman task add "<prompt>" [options]
  --dir <path>           Working directory
  --priority <n>         Priority (higher = processed first)
  --completion <phrase>  Custom completion phrase to detect
  --timeout <ms>         Task timeout in milliseconds

# List tasks
claudeman task list
claudeman task list --status pending

# View task details
claudeman task status <task-id>

# Remove a task
claudeman task remove <task-id>

# Clear tasks
claudeman task clear              # completed tasks
claudeman task clear --failed     # failed tasks
claudeman task clear --all        # all tasks
```

### Ralph Loop

```bash
# Start the autonomous loop
claudeman ralph start
claudeman ralph start --min-hours 4      # run for at least 4 hours
claudeman ralph start --no-auto-generate # disable auto task generation

# Stop the loop
claudeman ralph stop

# Check loop status
claudeman ralph status
```

### Respawn Controller (Web Interface)

The respawn controller keeps interactive sessions productive by automatically cycling through update prompts:

1. Detects when session goes idle (prompt character visible, no activity)
2. Sends configured update prompt (default: "update all the docs and CLAUDE.md")
3. Sends `/clear` command to reset context
4. Sends `/init` to reinitialize
5. Repeats

**Configuration via API:**
```bash
# Start respawn with custom config
curl -X POST localhost:3000/api/sessions/:id/respawn/start \
  -H "Content-Type: application/json" \
  -d '{"config": {"idleTimeoutMs": 10000, "updatePrompt": "run tests and fix issues"}}'

# Update config on running respawn
curl -X PUT localhost:3000/api/sessions/:id/respawn/config \
  -H "Content-Type: application/json" \
  -d '{"updatePrompt": "refactor the API layer"}'
```

**State Machine:**
```
WATCHING → SENDING_UPDATE → WAITING_UPDATE → SENDING_CLEAR → WAITING_CLEAR → SENDING_INIT → WAITING_INIT → WATCHING
```

### Utility

```bash
# Overall status
claudeman status

# Reset all state (stops sessions, clears tasks)
claudeman reset --force
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claudeman CLI                        │
├─────────────────────────────────────────────────────────┤
│  Ralph Loop Controller                                  │
│  - Monitors all sessions                                │
│  - Assigns tasks from queue                             │
│  - Detects completion/failure                           │
│  - Self-generates follow-up tasks                       │
├─────────────────────────────────────────────────────────┤
│  Session Manager              │  Task Queue             │
│  - Spawn claude processes     │  - Priority queue       │
│  - Track stdin/stdout/stderr  │  - Task definitions     │
│  - Health monitoring          │  - Dependencies         │
│  - Graceful shutdown          │  - Status tracking      │
├─────────────────────────────────────────────────────────┤
│  State Store (JSON file persistence)                    │
│  - Sessions, tasks, logs                                │
└─────────────────────────────────────────────────────────┘
```

## Completion Detection

The Ralph Loop detects task completion by looking for:

1. **Promise tags**: `<promise>COMPLETE</promise>` or custom phrases
2. **Common indicators**: "Task completed successfully", "All tasks done", "✓ Complete"

When creating tasks, you can specify a custom completion phrase:

```bash
claudeman task add "Refactor the auth module" --completion "AUTH_REFACTOR_DONE"
```

The session output will be scanned for `<promise>AUTH_REFACTOR_DONE</promise>`.

## Time-Aware Loops

For extended autonomous work sessions:

```bash
claudeman ralph start --min-hours 8
```

When the minimum duration hasn't been reached and all tasks are complete, the Ralph Loop will auto-generate follow-up tasks like:

- Review and optimize recently changed code
- Add tests for uncovered code paths
- Update documentation
- Check for security vulnerabilities
- Run linting and fix issues

## State File

All state is persisted to `~/.claudeman/state.json`:

```json
{
  "sessions": { ... },
  "tasks": { ... },
  "ralphLoop": {
    "status": "running",
    "startedAt": 1234567890,
    "minDurationMs": 14400000,
    "tasksCompleted": 5,
    "tasksGenerated": 2
  },
  "config": {
    "pollIntervalMs": 1000,
    "defaultTimeoutMs": 300000,
    "maxConcurrentSessions": 5
  }
}
```

## Development

```bash
# Run in development mode
npm run dev -- start

# Build
npm run build

# Clean build artifacts
npm run clean
```

## Requirements

- Node.js 18+
- Claude CLI (`claude`) installed and available in PATH
