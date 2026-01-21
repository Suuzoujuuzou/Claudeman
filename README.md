# Claudeman

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-196%20passing-success)](./test)

**Take full control of your Claude Code sessions like never before.**

Claudeman is the ultimate session manager for Claude Code power users. Spawn up to 20 parallel Claude CLI sessions, run them autonomously for 24+ hours, and never lose work thanks to persistent GNU Screen sessions. Whether you're running overnight code reviews, parallel feature development, or time-boxed sprints - Claudeman keeps your AI assistant productive while you sleep.

> 🎯 **Perfect for**: Autonomous coding sprints, overnight refactors, parallel development, long-running code reviews, time-boxed AI tasks

---

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Screenshots](#screenshots)
- [Features](#features)
- [Ralph Loop](#ralph-loop)
- [Respawn Controller](#respawn-controller)
- [Inner Loop Tracking](#inner-loop-tracking)
- [Token Management](#token-management)
- [Web Interface](#web-interface)
- [CLI Commands](#cli-commands)
- [Screen Manager TUI](#screen-manager-interactive-tui)
- [API Reference](#api-reference)
- [Long-Running Sessions](#long-running-sessions)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

| Feature | Description |
|---------|-------------|
| **Up to 20 Parallel Sessions** | Spawn multiple Claude CLI sessions with full terminal access |
| **Session Persistence** | GNU Screen sessions survive server restarts - never lose work |
| **Screen-Aware Sessions** | Claude sessions know they're in Claudeman via `CLAUDEMAN_SCREEN` env var |
| **Ralph Loop** | Autonomous control loop that keeps Claude working 24+ hours |
| **Time-Aware Sessions** | Run Claude for specific durations ("work for 8 hours") |
| **Auto Context Management** | Automatic `/clear` and `/compact` when tokens get high |
| **Memory Management** | 5MB terminal buffers with automatic trimming for long sessions |
| **Real-time Monitoring** | Track tokens, costs, memory, CPU, and background tasks |
| **Inner Loop Tracking** | Detect Ralph loops and todos running inside Claude Code |
| **Screen Manager TUI** | Interactive bash tool for managing screen sessions |
| **60fps Rendering** | Smooth terminal streaming with batched updates |

---

## Quick Start

### Installation

```bash
git clone https://github.com/yourusername/claudeman.git
cd claudeman
npm install
npm run build
npm link  # Optional: make 'claudeman' globally available
```

### Start the Web Interface

```bash
claudeman web
# Open http://localhost:3000
```

### Your First Session

1. Click **"Run Claude"** or press `Ctrl+Enter`
2. A case folder is created in `~/claudeman-cases/`
3. An interactive Claude terminal opens
4. Start working!

---

## Screenshots

### Main Interface

![Main Interface](docs/screenshots/main-interface.png)

*The Claudeman web interface with session tabs, terminal, and control panels*

### Session Running

![Session Running](docs/screenshots/session-running.png)

*An active Claude session with real-time terminal output*

---

## Features

### Session Management
- Spawn up to 20 parallel Claude CLI sessions as PTY subprocesses
- Full terminal access with resize support and buffer persistence
- One-click kill for individual sessions or all at once
- Session restoration after server restarts via GNU Screen
- **Screen-aware sessions**: Claude knows it's running in Claudeman via environment variables

### Screen-Aware Sessions

Every Claude session spawned by Claudeman receives special environment variables:

| Variable | Description |
|----------|-------------|
| `CLAUDEMAN_SCREEN=1` | Indicates running within Claudeman |
| `CLAUDEMAN_SESSION_ID` | The session's unique identifier |
| `CLAUDEMAN_SCREEN_NAME` | The GNU Screen session name |

This helps prevent Claude from accidentally terminating its own screen session and allows sessions to be aware of their managed environment.

### Autonomous Operation
- **Respawn Controller**: State machine that cycles sessions (update → /clear → /init)
- **Ralph Loop**: Assigns tasks to idle sessions and monitors completion
- **Time-Aware Loops**: Auto-generate follow-up tasks when minimum duration not reached
- **Completion Detection**: Detect `<promise>PHRASE</promise>` patterns

### Context Management
- **Token Tracking**: Real-time input/output token counts per session
- **Auto-Compact**: Send `/compact` when tokens exceed 110k (configurable)
- **Auto-Clear**: Send `/clear` when tokens exceed 140k (configurable)
- **Buffer Trimming**: Automatic memory management for 12-24+ hour sessions

### Monitoring
- **Inner Loop Tracking**: Detect Ralph loops and todos inside Claude Code
- **Background Task Tracking**: Tree view of Claude's spawned tasks
- **Cost Tracking**: Total API costs across all sessions
- **Resource Monitoring**: Memory usage with color-coded warnings

---

## Ralph Loop

The **Ralph Loop** is Claudeman's signature feature - an autonomous control loop that keeps Claude working on tasks continuously.

### How It Works

1. **Assign task** to idle session
2. **Monitor output** for completion signals
3. **Detect completion** via `<promise>COMPLETE</promise>` or indicators
4. **Mark complete**, assign next task
5. **Auto-generate tasks** if min-time not reached and queue empty
6. **Repeat** until all done

### Starting a Ralph Loop

```bash
# Basic Ralph loop
claudeman ralph start

# Run for at least 4 hours
claudeman ralph start --min-hours 4

# Run for 8 hours without auto-generation
claudeman ralph start --min-hours 8 --no-auto-generate
```

### Completion Detection

The Ralph Loop detects task completion through several patterns:

| Pattern | Example |
|---------|---------|
| Promise tags | `<promise>COMPLETE</promise>` |
| Custom phrases | `<promise>AUTH_REFACTOR_DONE</promise>` |
| Common indicators | "Task completed successfully", "All done" |
| Checkmarks | "✓ Complete", "✔ Finished" |

**Custom completion phrase:**

```bash
claudeman task add "Refactor the auth module" --completion "AUTH_DONE"
# Claude outputs: <promise>AUTH_DONE</promise> when finished
```

### Time-Aware Loops

When the minimum duration hasn't been reached and all tasks complete, the Ralph Loop auto-generates follow-up tasks:

- Review and optimize recently changed code
- Add tests for uncovered code paths
- Update documentation
- Check for security vulnerabilities
- Run linting and fix issues

### Use Cases

**Overnight Code Review**
```bash
claudeman ralph start --min-hours 8
claudeman task add "Review all code in src/ for bugs and improvements"
claudeman task add "Add missing tests for edge cases"
# Let it run overnight
```

**Feature Implementation Sprint**
```bash
claudeman task add "Implement user authentication with JWT" --completion "AUTH_DONE"
claudeman task add "Add login/logout endpoints" --completion "ENDPOINTS_DONE"
claudeman task add "Write integration tests" --completion "TESTS_DONE"
claudeman ralph start --min-hours 4
```

**Continuous Documentation**
```bash
# Start a session and enable respawn
claudeman web
# In web UI: Start session, enable respawn with prompt:
# "Update documentation for any changed files, then update CLAUDE.md"
```

**Parallel Development**
```bash
claudeman web
# Create 3 sessions working on different modules
# Session 1: Frontend components
# Session 2: Backend API
# Session 3: Database migrations
```

---

## Respawn Controller

The **Respawn Controller** keeps interactive sessions productive by automatically cycling through update prompts.

### State Flow

**WATCHING** → **SENDING_UPDATE** → **WAITING_UPDATE** → **SENDING_CLEAR** → **WAITING_CLEAR** → **SENDING_INIT** → **WAITING_INIT** → **MONITORING_INIT** → back to **WATCHING**

Optional: **SENDING_KICKSTART** → **WAITING_KICKSTART** if /init doesn't trigger work

### States Explained

| State | Description |
|-------|-------------|
| `WATCHING` | Monitoring session for idle state |
| `SENDING_UPDATE` | Sending the update prompt |
| `WAITING_UPDATE` | Waiting for Claude to process |
| `SENDING_CLEAR` | Sending `/clear` command |
| `WAITING_CLEAR` | Waiting for context to clear |
| `SENDING_INIT` | Sending `/init` command |
| `WAITING_INIT` | Waiting for initialization |
| `MONITORING_INIT` | Checking if work started |

### Configuration

```bash
# Start respawn with config
curl -X POST localhost:3000/api/sessions/:id/respawn/start \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "idleTimeoutMs": 5000,
      "updatePrompt": "continue working on the current task",
      "sendClear": true,
      "sendInit": true
    }
  }'

# Enable with timed duration (120 minutes)
curl -X POST localhost:3000/api/sessions/:id/respawn/enable \
  -H "Content-Type: application/json" \
  -d '{
    "config": {"updatePrompt": "keep improving the code"},
    "durationMinutes": 120
  }'
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `idleTimeoutMs` | 5000 | Time to wait after idle before cycling |
| `updatePrompt` | "update all docs..." | Prompt sent when session goes idle |
| `sendClear` | true | Whether to send `/clear` after update |
| `sendInit` | true | Whether to send `/init` after clear |
| `kickstartPrompt` | null | Optional prompt if /init doesn't trigger work |

---

## Inner Loop Tracking

Claudeman detects when Claude Code runs its own Ralph Wiggum loops or uses TodoWrite internally.

### Detected Patterns

| Pattern | Example |
|---------|---------|
| Completion phrases | `<promise>COMPLETE</promise>` |
| Todo checkboxes | `- [ ] Task`, `- [x] Done` |
| Todo indicators | `☐ Pending`, `◐ In Progress`, `✓ Complete` |
| Iteration patterns | `Iteration 5/50`, `[5/50]` |
| Loop commands | `/ralph-loop:ralph-loop` |
| Completion messages | "All tasks completed" |

### Session-Scoped

Each session has its **own independent tracker**:
- **New session** → Fresh tracker
- **Close tab** → Tracker state cleared
- **Switch tabs** → Panel shows tracker for active session

### UI Display

A collapsible panel shows:
- **Collapsed**: Summary like "Loop: TIME_COMPLETE (2.3h) | Tasks: 3/5"
- **Expanded**: Full todo list with progress ring

### API

```bash
# Get inner state
curl localhost:3000/api/sessions/:id/inner-state

# Reset tracker
curl -X POST localhost:3000/api/sessions/:id/inner-config \
  -H "Content-Type: application/json" \
  -d '{"reset": true}'
```

---

## Token Management

### Token Tracking

- **Interactive mode**: Parses tokens from Claude's status line
- **One-shot mode**: Uses `--output-format stream-json`
- **Estimation**: 60/40 input/output split for interactive

### Auto-Compact

Automatically sends `/compact` when tokens exceed threshold:

```bash
curl -X POST localhost:3000/api/sessions/:id/auto-compact \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "threshold": 110000}'
```

### Auto-Clear

Automatically sends `/clear` when tokens exceed threshold:

```bash
curl -X POST localhost:3000/api/sessions/:id/auto-clear \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "threshold": 140000}'
```

| Feature | Default Threshold | Action |
|---------|------------------|--------|
| Auto-Compact | 110k tokens | `/compact` |
| Auto-Clear | 140k tokens | `/clear` |

---

## Web Interface

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Create case and start session |
| `Ctrl+W` | Close current session |
| `Ctrl+Tab` | Switch to next session |
| `Ctrl+K` | Kill all sessions |
| `Ctrl+L` | Clear terminal |
| `Ctrl++/-` | Adjust font size |
| `Escape` | Close panels |

### Multi-Tab Sessions

1. Set the number (1-20) in the tab count stepper
2. Click "Run Claude"
3. Sessions named `w1-projectname`, `w2-projectname`, etc.
4. Tabs wrap nicely into multiple rows for easy navigation

### Monitor Panel

Combined view of:
- **Screen Sessions**: All GNU screen sessions with status
- **Background Tasks**: Tree view of Claude's spawned tasks

### UI Features

- 60fps rendering with batching
- Auto-focus for single sessions
- Scroll preservation when expanding panels
- Toast notifications
- Mobile-responsive design

---

## CLI Commands

### Sessions

```bash
claudeman start [--dir <path>]       # Start session
claudeman list                       # List sessions
claudeman session stop <id>          # Stop session
claudeman session logs <id>          # View output
```

### Tasks

```bash
claudeman task add "<prompt>" [options]
  --dir <path>           # Working directory
  --priority <n>         # Priority (higher = first)
  --completion <phrase>  # Completion phrase
  --timeout <ms>         # Timeout

claudeman task list [--status pending]
claudeman task remove <id>
claudeman task clear [--all|--failed]
```

### Ralph Loop

```bash
claudeman ralph start [--min-hours 4]
claudeman ralph stop
claudeman ralph status
```

### Server

```bash
claudeman web [-p 8080]
claudeman status
claudeman reset --force
```

### Screen Manager (Interactive TUI)

```bash
./scripts/screen-manager.sh           # Interactive mode with arrow navigation
./scripts/screen-manager.sh list      # List all sessions
./scripts/screen-manager.sh attach 1  # Attach to session #1
./scripts/screen-manager.sh kill 2,3  # Kill sessions 2 and 3
./scripts/screen-manager.sh kill 1-5  # Kill sessions 1 through 5
./scripts/screen-manager.sh kill-all  # Kill all sessions
./scripts/screen-manager.sh info 1    # Show session #1 details
```

**Interactive Controls:**
- `↑`/`↓` or `j`/`k` - Navigate sessions
- `Enter` - Attach to selected session (Ctrl+A D to detach)
- `d` - Delete selected session
- `D` - Delete ALL sessions
- `i` - Show session info
- `q`/`Esc` - Quit

Requires `jq` and `screen` packages.

---

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions/:id` | Get details |
| `DELETE` | `/api/sessions/:id` | Delete |
| `POST` | `/api/sessions/:id/input` | Send input |
| `POST` | `/api/sessions/:id/resize` | Resize terminal |
| `POST` | `/api/sessions/:id/interactive` | Start interactive |

### Respawn

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/:id/respawn/start` | Start |
| `POST` | `/api/sessions/:id/respawn/stop` | Stop |
| `POST` | `/api/sessions/:id/respawn/enable` | Enable with timer |
| `PUT` | `/api/sessions/:id/respawn/config` | Update config |

### Inner Loop

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions/:id/inner-state` | Get state |
| `POST` | `/api/sessions/:id/inner-config` | Configure |

### Auto Context

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/:id/auto-compact` | Configure |
| `POST` | `/api/sessions/:id/auto-clear` | Configure |

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events` | SSE stream |
| `GET` | `/api/status` | Full state |
| `GET` | `/api/screens` | Screen list |

### Cases

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cases` | List cases |
| `POST` | `/api/cases` | Create case |
| `POST` | `/api/quick-start` | Quick start |

---

## Long-Running Sessions

Optimized for 12-24+ hour autonomous sessions with intelligent memory management.

### Buffer Limits

Automatic trimming prevents memory exhaustion during long sessions:

| Buffer | Max Size | Trim To | Purpose |
|--------|----------|---------|---------|
| Terminal | 5MB | 4MB | Raw PTY output with ANSI codes |
| Text output | 2MB | 1.5MB | ANSI-stripped text for processing |
| Messages | 1000 | 800 | Parsed Claude JSON messages |
| Line buffer | 64KB | flush 100ms | Line-by-line processing buffer |
| Respawn buffer | 1MB | 512KB | Terminal data for respawn controller |

### Memory Management

Claudeman is designed for stability during extended sessions:

- **Automatic buffer trimming**: Keeps the most recent data when limits exceeded
- **Debounced state saves**: 500ms batching prevents disk I/O storms
- **Process cleanup**: Aggressive cleanup of orphaned screen sessions
- **Event listener tracking**: Prevents memory leaks from unremoved listeners
- **Separate state files**: Inner loop state in separate file to reduce write frequency

### Performance

- Server batching at 60fps (16ms) for smooth terminal streaming
- Client `requestAnimationFrame` batching for smooth rendering
- Pre-compiled regex patterns (avoid recompilation in hot loops)
- Child process resource monitoring with color-coded warnings

### Best Practices

1. Enable auto-compact (threshold below auto-clear)
2. Use screen sessions for persistence
3. Monitor resource usage indicators
4. Commit frequently in Ralph loops
5. Plan for periodic breaks

---

## Troubleshooting

### Session Won't Start

```bash
which claude                     # Check CLI available
claude --version                 # Check version
screen -ls                       # Check screen sessions
pkill -f "SCREEN.*claudeman"     # Kill stuck screens
```

### High Memory Usage

```bash
curl localhost:3000/api/sessions/:id  # Check buffer sizes

# Lower auto-clear threshold
curl -X POST localhost:3000/api/sessions/:id/auto-clear \
  -d '{"enabled": true, "threshold": 100000}'
```

### Respawn Not Working

1. Check for `↵ send` idle indicator
2. Verify respawn enabled via API
3. Check respawn state is `watching`
4. Increase `idleTimeoutMs` if needed

### Screen Issues

Use the interactive screen manager for easy session management:

```bash
./scripts/screen-manager.sh           # Interactive TUI
./scripts/screen-manager.sh list      # List all sessions
./scripts/screen-manager.sh kill-all  # Kill all sessions
```

Or use raw commands:

```bash
screen -ls | grep claudeman           # List screens
screen -X -S claudeman-<id> quit      # Kill specific
pkill -f "SCREEN.*claudeman"          # Kill all
```

---

## FAQ

**Q: How long can sessions run?**
A: 24+ hours. Buffer management keeps memory stable.

**Q: Does it work with Claude Code hooks?**
A: Yes! Claudeman spawns real Claude CLI processes.

**Q: Can I run multiple sessions?**
A: Yes, the web UI supports up to 20 concurrent sessions per case. The API supports up to 50.

**Q: What if the server restarts?**
A: Screen sessions persist and auto-restore.

**Q: How does token counting work?**
A: Parses Claude's status line (e.g., "123.4k tokens").

**Q: Custom completion phrases?**
A: Yes! Use `--completion` flag or `<promise>PHRASE</promise>`.

---

## Development

### Setup

```bash
npm install
npx tsx src/index.ts web    # Dev mode
npm run build               # Production
npx tsc --noEmit            # Type check
```

### Testing

```bash
npm run test                # All tests (195)
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage
npx vitest run -t "name"    # By pattern
```

### Test Ports

| Port | Test File |
|------|-----------|
| 3099 | quick-start.test.ts |
| 3102 | session.test.ts |
| 3105 | scheduled-runs.test.ts |
| 3107 | sse-events.test.ts |
| 3110 | edge-cases.test.ts |
| 3115 | integration-flows.test.ts |
| 3120 | session-cleanup.test.ts |

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Write tests for new functionality
4. Ensure tests pass (`npm test`)
5. Commit with conventional commits (`feat:`, `fix:`, `docs:`)
6. Open Pull Request

### Code Style

- TypeScript strict mode
- ES2022 target, NodeNext modules
- Pre-compile regex patterns

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Claude Code](https://claude.ai/code) by Anthropic
- [xterm.js](https://xtermjs.org/) for terminal rendering
- [Fastify](https://fastify.io/) for the web server
- [node-pty](https://github.com/microsoft/node-pty) for PTY
- [GNU Screen](https://www.gnu.org/software/screen/) for persistence

---

<p align="center">
  Made with care for autonomous AI development
</p>
