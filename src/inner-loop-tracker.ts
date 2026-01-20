import { EventEmitter } from 'node:events';
import {
  InnerLoopState,
  InnerTodoItem,
  InnerTodoStatus,
  createInitialInnerLoopState,
} from './types.js';

// Maximum number of todo items to track per session
const MAX_TODO_ITEMS = 50;
// Todo items older than this will be auto-expired (1 hour)
const TODO_EXPIRY_MS = 60 * 60 * 1000;
// Throttle cleanup checks (every 30 seconds)
const CLEANUP_THROTTLE_MS = 30 * 1000;

// Pre-compiled regex patterns for performance (avoid re-compilation on each call)

// Completion phrase detection: <promise>PHRASE</promise>
const PROMISE_PATTERN = /<promise>([^<]+)<\/promise>/;

// Todo item patterns - multiple formats Claude Code uses
// Format 1: Checkbox format in markdown: "- [ ] Task" or "- [x] Task"
const TODO_CHECKBOX_PATTERN = /^[-*]\s*\[([xX ])\]\s+(.+)$/gm;
// Format 2: Todo with indicator icons: "Todo: ☐ Task", "Todo: ◐ Task", "Todo: ✓ Task"
const TODO_INDICATOR_PATTERN = /Todo:\s*(☐|◐|✓|⏳|✅|⌛|🔄)\s+(.+)/g;
// Format 3: Status in parentheses: "(pending)", "(in_progress)", "(completed)"
const TODO_STATUS_PATTERN = /[-*]\s*(.+?)\s+\((pending|in_progress|completed)\)/g;
// Format 4: Claude Code native TodoWrite output: "☐ Task", "☒ Task", "◐ Task"
// These appear in terminal with optional leading whitespace/brackets like "⎿  ☐ Task"
// Matches: start of line with optional whitespace/bracket, then checkbox, then task text
const TODO_NATIVE_PATTERN = /^[\s⎿]*(☐|☒|◐)\s+([^☐☒◐\n]{3,})/gm;

// Patterns to exclude from todo detection (tool invocations, etc.)
const TODO_EXCLUDE_PATTERNS = [
  /^(?:Bash|Search|Read|Write|Glob|Grep|Edit|Task)\s*\(/i,  // Tool invocations
  /^(?:I'll |Let me |Now I|First,|Task \d+:|Result:|Error:)/i,  // Claude commentary (with context)
  /^\S+\([^)]+\)$/,                                          // Generic function call pattern
];

// Loop status patterns (does NOT include <promise> - that's handled by PROMISE_PATTERN)
const LOOP_START_PATTERN = /Loop started at|Starting.*loop|Ralph loop started/i;
const ELAPSED_TIME_PATTERN = /Elapsed:\s*(\d+(?:\.\d+)?)\s*hours?/i;
const CYCLE_PATTERN = /cycle\s*#?(\d+)|respawn cycle #(\d+)/i;

// New patterns for improved Ralph detection (based on official Ralph Wiggum plugin)
// Iteration patterns: "Iteration 5/50", "[5/50]", "iteration #5"
const ITERATION_PATTERN = /(?:iteration|iter\.?)\s*#?(\d+)(?:\s*[\/of]\s*(\d+))?|\[(\d+)\/(\d+)\]/i;

// Ralph loop start: "/ralph-loop:ralph-loop" command or "Starting Ralph loop"
// Pattern matches /ralph-loop anywhere to catch both skill invocations and output
const RALPH_START_PATTERN = /\/ralph-loop|starting ralph(?:\s+wiggum)?\s+loop|ralph loop (?:started|beginning)/i;

// Max iterations: "max-iterations 50" or "maxIterations: 50" or "max_iterations=50"
const MAX_ITERATIONS_PATTERN = /max[_-]?iterations?\s*[=:]\s*(\d+)/i;

// TodoWrite tool output - detect the tool being used
const TODOWRITE_PATTERN = /TodoWrite|todo(?:s)?\s*(?:updated|written|saved)|Todos have been modified/i;

// All tasks complete patterns - detect when Claude says all work is done
// Includes patterns like "All 8 files have been created", "All tasks completed"
const ALL_COMPLETE_PATTERN = /all\s+(?:\d+\s+)?(?:tasks?|files?|items?)\s+(?:have\s+been\s+|are\s+)?(?:completed?|done|finished|created)|completed?\s+all\s+(?:\d+\s+)?tasks?|all\s+done|everything\s+(?:is\s+)?(?:completed?|done)|finished\s+all\s+tasks?/i;

// Pattern to extract count from "All 8 files created" type messages
const ALL_COUNT_PATTERN = /all\s+(\d+)\s+(?:tasks?|files?|items?)/i;

// Individual task completion patterns - detect when Claude marks a specific task done
const TASK_DONE_PATTERN = /(?:task|item|todo)\s*(?:#?\d+|"\s*[^"]+\s*")?\s*(?:is\s+)?(?:done|completed?|finished)|(?:completed?|done|finished)\s+(?:task|item)\s*(?:#?\d+)?|marking\s+(?:.*?\s+)?(?:as\s+)?completed?|marked\s+(?:.*?\s+)?(?:as\s+)?completed?/i;

// Generic completion signals (be careful with these - can be false positives)
const COMPLETION_SIGNAL_PATTERN = /^(?:done|completed?|finished|all\s+set)!?\s*$/i;

// ANSI escape code removal for cleaner parsing
// Matches color codes (\x1b[...m), cursor movement (\x1b[...H, \x1b[...C, etc.), and other sequences
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface InnerLoopTrackerEvents {
  loopUpdate: (state: InnerLoopState) => void;
  todoUpdate: (todos: InnerTodoItem[]) => void;
  completionDetected: (phrase: string) => void;
  enabled: () => void;  // Emitted when tracker auto-enables
}

/**
 * InnerLoopTracker parses terminal output from Claude Code sessions to detect:
 * 1. Ralph Wiggum loop state (active, completion phrase, cycle count)
 * 2. Todo list items from the TodoWrite tool
 *
 * The tracker is DISABLED by default and auto-enables when Ralph-related
 * patterns are detected (e.g., /ralph-loop:ralph-loop, <promise>, todos).
 */
export class InnerLoopTracker extends EventEmitter {
  private _loopState: InnerLoopState;
  private _todos: Map<string, InnerTodoItem> = new Map();
  private _lineBuffer: string = '';
  // Track occurrences of completion phrases to distinguish prompt from actual completion
  private _completionPhraseCount: Map<string, number> = new Map();
  // Throttle cleanup to avoid running on every data chunk
  private _lastCleanupTime: number = 0;

  constructor() {
    super();
    this._loopState = createInitialInnerLoopState();
  }

  /**
   * Whether the tracker is enabled and actively monitoring
   */
  get enabled(): boolean {
    return this._loopState.enabled;
  }

  /**
   * Enable the tracker (called automatically when Ralph patterns detected)
   */
  enable(): void {
    if (!this._loopState.enabled) {
      this._loopState.enabled = true;
      this._loopState.lastActivity = Date.now();
      this.emit('enabled');
      this.emit('loopUpdate', this.loopState);
    }
  }

  /**
   * Disable the tracker
   */
  disable(): void {
    if (this._loopState.enabled) {
      this._loopState.enabled = false;
      this._loopState.lastActivity = Date.now();
      this.emit('loopUpdate', this.loopState);
    }
  }

  /**
   * Reset the tracker to initial state (for when a new task/loop starts)
   * Clears all todos, completion phrase, and loop state while keeping enabled status
   */
  reset(): void {
    const wasEnabled = this._loopState.enabled;
    this._loopState = createInitialInnerLoopState();
    this._loopState.enabled = wasEnabled;  // Keep enabled status
    this._todos.clear();
    this._completionPhraseCount.clear();
    this._lineBuffer = '';
    this.emit('loopUpdate', this.loopState);
    this.emit('todoUpdate', this.todos);
  }

  /**
   * Full reset including enabled state (for complete cleanup)
   */
  fullReset(): void {
    this._loopState = createInitialInnerLoopState();
    this._todos.clear();
    this._completionPhraseCount.clear();
    this._lineBuffer = '';
    this.emit('loopUpdate', this.loopState);
    this.emit('todoUpdate', this.todos);
  }

  get loopState(): InnerLoopState {
    return { ...this._loopState };
  }

  get todos(): InnerTodoItem[] {
    return Array.from(this._todos.values());
  }

  /**
   * Process raw terminal data to detect inner loop patterns
   */
  processTerminalData(data: string): void {
    // Remove ANSI escape codes for cleaner parsing
    const cleanData = data.replace(ANSI_ESCAPE_PATTERN, '');

    // If tracker is disabled, only check for patterns that should auto-enable it
    if (!this._loopState.enabled) {
      if (this.shouldAutoEnable(cleanData)) {
        this.enable();
        // Continue processing now that we're enabled
      } else {
        return; // Don't process further when disabled
      }
    }

    // Buffer data for line-based processing
    this._lineBuffer += cleanData;

    // Process complete lines
    const lines = this._lineBuffer.split('\n');
    this._lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      this.processLine(line);
    }

    // Also check the current buffer for multi-line patterns
    this.checkMultiLinePatterns(cleanData);

    // Cleanup expired todos (throttled to avoid running on every chunk)
    this.maybeCleanupExpiredTodos();
  }

  /**
   * Check if the data contains patterns that should auto-enable the tracker
   */
  private shouldAutoEnable(data: string): boolean {
    // Ralph loop command: /ralph-loop:ralph-loop
    if (RALPH_START_PATTERN.test(data)) {
      return true;
    }

    // Completion phrase: <promise>...</promise>
    if (PROMISE_PATTERN.test(data)) {
      return true;
    }

    // TodoWrite tool usage
    if (TODOWRITE_PATTERN.test(data)) {
      return true;
    }

    // Iteration patterns from Ralph loop: "Iteration 5/50", "[5/50]"
    if (ITERATION_PATTERN.test(data)) {
      return true;
    }

    // Todo checkboxes: "- [ ] Task" or "- [x] Task"
    if (TODO_CHECKBOX_PATTERN.test(data)) {
      // Reset lastIndex since we're reusing the global regex
      TODO_CHECKBOX_PATTERN.lastIndex = 0;
      return true;
    }

    // Todo indicator icons: "Todo: ☐", "Todo: ◐", etc.
    if (TODO_INDICATOR_PATTERN.test(data)) {
      TODO_INDICATOR_PATTERN.lastIndex = 0;
      return true;
    }

    // Claude Code native todo format: "☐ Task", "☒ Task"
    if (TODO_NATIVE_PATTERN.test(data)) {
      TODO_NATIVE_PATTERN.lastIndex = 0;
      return true;
    }

    // Loop start patterns (e.g., "Loop started at", "Starting Ralph loop")
    if (LOOP_START_PATTERN.test(data)) {
      return true;
    }

    // All tasks complete signals
    if (ALL_COMPLETE_PATTERN.test(data)) {
      return true;
    }

    // Task completion signals
    if (TASK_DONE_PATTERN.test(data)) {
      return true;
    }

    return false;
  }

  /**
   * Process a single line of terminal output
   */
  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Check for completion phrase
    this.detectCompletionPhrase(trimmed);

    // Check for "all tasks complete" signals
    this.detectAllTasksComplete(trimmed);

    // Check for individual task completion signals
    this.detectTaskCompletion(trimmed);

    // Check for loop start/status
    this.detectLoopStatus(trimmed);

    // Check for todo items
    this.detectTodoItems(trimmed);
  }

  /**
   * Detect "all tasks complete" messages
   * When detected: marks all todos as complete AND emits completion event
   */
  private detectAllTasksComplete(line: string): void {
    // Only trigger if line is a clear standalone completion message
    // Avoid matching commentary like "once all tasks are complete..."
    if (!ALL_COMPLETE_PATTERN.test(line)) return;

    // Must be a reasonably short line (< 100 chars) to be a completion signal, not commentary
    if (line.length > 100) return;

    // Skip if this looks like it's part of the original prompt (contains "output:")
    if (line.toLowerCase().includes('output:') || line.includes('<promise>')) return;

    // Don't trigger if we haven't seen any todos yet
    if (this._todos.size === 0) return;

    // Check if the count matches our todo count (e.g., "All 8 files created")
    const countMatch = line.match(ALL_COUNT_PATTERN);
    const mentionedCount = countMatch ? parseInt(countMatch[1]) : null;
    const todoCount = this._todos.size;

    // If a count is mentioned, it should match our todo count (within reason)
    if (mentionedCount !== null && Math.abs(mentionedCount - todoCount) > 2) {
      // Count doesn't match our todos, might be unrelated
      return;
    }

    // Mark all todos as complete
    let updated = false;
    for (const todo of this._todos.values()) {
      if (todo.status !== 'completed') {
        todo.status = 'completed';
        updated = true;
      }
    }
    if (updated) {
      this.emit('todoUpdate', this.todos);
    }

    // Emit completion if we have an expected phrase
    if (this._loopState.completionPhrase) {
      this._loopState.active = false;
      this._loopState.lastActivity = Date.now();
      this.emit('completionDetected', this._loopState.completionPhrase);
      this.emit('loopUpdate', this.loopState);
    }
  }

  /**
   * Detect individual task completion signals
   * e.g., "Task 8 is done", "marked as completed"
   *
   * NOTE: This is intentionally conservative to avoid jitter.
   * Only marks a todo complete if we can match it by task number.
   */
  private detectTaskCompletion(line: string): void {
    if (!TASK_DONE_PATTERN.test(line)) return;

    // Only act on explicit task number references like "Task 8 is done"
    const taskNumMatch = line.match(/task\s*#?(\d+)/i);
    if (taskNumMatch) {
      const taskNum = parseInt(taskNumMatch[1]);
      // Find the nth todo (by order) and mark it complete
      let count = 0;
      for (const [id, todo] of this._todos) {
        count++;
        if (count === taskNum && todo.status !== 'completed') {
          todo.status = 'completed';
          this.emit('todoUpdate', this.todos);
          break;
        }
      }
    }
    // Don't guess which todo to mark - let the checkbox detection handle it
  }

  /**
   * Check for multi-line patterns in the data chunk
   */
  private checkMultiLinePatterns(data: string): void {
    // Completion phrase can span lines, so check the whole chunk
    const promiseMatch = data.match(PROMISE_PATTERN);
    if (promiseMatch) {
      this.handleCompletionPhrase(promiseMatch[1]);
    }
  }

  /**
   * Detect <promise>PHRASE</promise> completion phrases
   * Also detects bare phrase (without tags) if we already know the expected phrase
   */
  private detectCompletionPhrase(line: string): void {
    // First check for tagged phrase: <promise>PHRASE</promise>
    const match = line.match(PROMISE_PATTERN);
    if (match) {
      this.handleCompletionPhrase(match[1]);
      return;
    }

    // If we have an expected completion phrase, also check for bare phrase
    // This handles cases where Claude outputs "ALL_TASKS_DONE" without the tags
    const expectedPhrase = this._loopState.completionPhrase;
    if (expectedPhrase && line.includes(expectedPhrase)) {
      // Avoid false positives: don't trigger on the original prompt echo
      // Only trigger if line looks like completion output (standalone or at end)
      const isStandalone = line.trim() === expectedPhrase;
      const isAtEnd = line.trim().endsWith(expectedPhrase);
      const isNotInPromptContext = !line.includes('<promise>') && !line.includes('output:');

      if ((isStandalone || isAtEnd) && isNotInPromptContext) {
        this.handleBareCompletionPhrase(expectedPhrase);
      }
    }
  }

  /**
   * Handle a bare completion phrase (without tags)
   * Emits completion if we've already seen the tagged version in the prompt
   * and this appears to be actual completion output (not prompt echo)
   */
  private handleBareCompletionPhrase(phrase: string): void {
    // Only count if this phrase was already seen in tagged form (from the prompt)
    const taggedCount = this._completionPhraseCount.get(phrase) || 0;
    if (taggedCount === 0) return;

    // Track bare occurrences to avoid double-firing
    const bareKey = `bare:${phrase}`;
    const bareCount = (this._completionPhraseCount.get(bareKey) || 0) + 1;
    this._completionPhraseCount.set(bareKey, bareCount);

    // Only fire once for bare phrase
    if (bareCount > 1) return;

    // Mark all todos as complete (since we've reached the completion phrase)
    let updated = false;
    for (const todo of this._todos.values()) {
      if (todo.status !== 'completed') {
        todo.status = 'completed';
        updated = true;
      }
    }
    if (updated) {
      this.emit('todoUpdate', this.todos);
    }

    // Emit completion event
    this._loopState.active = false;
    this._loopState.lastActivity = Date.now();
    this.emit('completionDetected', phrase);
    this.emit('loopUpdate', this.loopState);
  }

  /**
   * Handle a detected completion phrase
   *
   * Uses occurrence-based detection to distinguish prompt from actual completion:
   * - 1st occurrence: Store as expected phrase (likely in prompt)
   * - 2nd occurrence: Emit completionDetected (actual completion)
   * - If loop already active: Emit immediately (explicit loop start)
   */
  private handleCompletionPhrase(phrase: string): void {
    const count = (this._completionPhraseCount.get(phrase) || 0) + 1;
    this._completionPhraseCount.set(phrase, count);

    // Store phrase on first occurrence
    if (!this._loopState.completionPhrase) {
      this._loopState.completionPhrase = phrase;
      this._loopState.lastActivity = Date.now();
      this.emit('loopUpdate', this.loopState);
    }

    // Emit completion if loop is active OR this is 2nd+ occurrence
    if (this._loopState.active || count >= 2) {
      // Mark all todos as complete when completion phrase is detected
      let updated = false;
      for (const todo of this._todos.values()) {
        if (todo.status !== 'completed') {
          todo.status = 'completed';
          updated = true;
        }
      }
      if (updated) {
        this.emit('todoUpdate', this.todos);
      }

      this._loopState.active = false;
      this._loopState.lastActivity = Date.now();
      this.emit('completionDetected', phrase);
      this.emit('loopUpdate', this.loopState);
    }
  }

  /**
   * Helper: Activate the loop if not already active
   */
  private activateLoopIfNeeded(): boolean {
    if (this._loopState.active) return false;

    this._loopState.active = true;
    this._loopState.startedAt = Date.now();
    this._loopState.cycleCount = 0;
    this._loopState.maxIterations = null;
    this._loopState.elapsedHours = null;
    this._loopState.lastActivity = Date.now();
    this.emit('loopUpdate', this.loopState);
    return true;
  }

  /**
   * Detect loop start and status indicators
   */
  private detectLoopStatus(line: string): void {
    // Check for Ralph loop start command (/ralph-loop:ralph-loop)
    // or generic loop start patterns ("Loop started at", "Starting Ralph loop")
    if (RALPH_START_PATTERN.test(line) || LOOP_START_PATTERN.test(line)) {
      this.activateLoopIfNeeded();
    }

    // Check for max iterations setting
    const maxIterMatch = line.match(MAX_ITERATIONS_PATTERN);
    if (maxIterMatch) {
      const maxIter = parseInt(maxIterMatch[1]);
      if (!isNaN(maxIter) && maxIter > 0) {
        this._loopState.maxIterations = maxIter;
        this._loopState.lastActivity = Date.now();
        this.emit('loopUpdate', this.loopState);
      }
    }

    // Check for iteration patterns: "Iteration 5/50", "[5/50]"
    const iterMatch = line.match(ITERATION_PATTERN);
    if (iterMatch) {
      // Pattern captures: group 1&2 for "Iteration X/Y", group 3&4 for "[X/Y]"
      const currentIter = parseInt(iterMatch[1] || iterMatch[3]);
      const maxIter = iterMatch[2] || iterMatch[4] ? parseInt(iterMatch[2] || iterMatch[4]) : null;

      if (!isNaN(currentIter)) {
        this.activateLoopIfNeeded();
        this._loopState.cycleCount = currentIter;
        if (maxIter !== null && !isNaN(maxIter)) {
          this._loopState.maxIterations = maxIter;
        }
        this._loopState.lastActivity = Date.now();
        this.emit('loopUpdate', this.loopState);
      }
    }

    // Check for elapsed time
    const elapsedMatch = line.match(ELAPSED_TIME_PATTERN);
    if (elapsedMatch) {
      this._loopState.elapsedHours = parseFloat(elapsedMatch[1]);
      this._loopState.lastActivity = Date.now();
      this.emit('loopUpdate', this.loopState);
    }

    // Check for cycle count (legacy pattern)
    const cycleMatch = line.match(CYCLE_PATTERN);
    if (cycleMatch) {
      const cycleNum = parseInt(cycleMatch[1] || cycleMatch[2]);
      if (!isNaN(cycleNum) && cycleNum > this._loopState.cycleCount) {
        this._loopState.cycleCount = cycleNum;
        this._loopState.lastActivity = Date.now();
        this.emit('loopUpdate', this.loopState);
      }
    }

    // Check for TodoWrite tool usage - indicates active task tracking
    if (TODOWRITE_PATTERN.test(line)) {
      this._loopState.lastActivity = Date.now();
      // Don't emit update just for activity, let todo detection handle it
    }
  }

  /**
   * Detect todo items in various formats
   */
  private detectTodoItems(line: string): void {
    // Quick check: skip lines that can't possibly contain todos
    // Must have: checkbox marker, icon, or parentheses status
    if (!line.includes('[') && !line.includes('☐') && !line.includes('☒') &&
        !line.includes('◐') && !line.includes('Todo:') && !line.includes('(pending)') &&
        !line.includes('(in_progress)') && !line.includes('(completed)')) {
      return;
    }

    let updated = false;

    // Format 1: Checkbox format "- [ ] Task" or "- [x] Task"
    TODO_CHECKBOX_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TODO_CHECKBOX_PATTERN.exec(line)) !== null) {
      const checked = match[1].toLowerCase() === 'x';
      const content = match[2].trim();
      const status: InnerTodoStatus = checked ? 'completed' : 'pending';
      this.upsertTodo(content, status);
      updated = true;
    }

    // Format 2: Todo with indicator icons
    TODO_INDICATOR_PATTERN.lastIndex = 0;
    while ((match = TODO_INDICATOR_PATTERN.exec(line)) !== null) {
      const icon = match[1];
      const content = match[2].trim();
      const status = this.iconToStatus(icon);
      this.upsertTodo(content, status);
      updated = true;
    }

    // Format 3: Status in parentheses
    TODO_STATUS_PATTERN.lastIndex = 0;
    while ((match = TODO_STATUS_PATTERN.exec(line)) !== null) {
      const content = match[1].trim();
      const status = match[2] as InnerTodoStatus;
      this.upsertTodo(content, status);
      updated = true;
    }

    // Format 4: Claude Code native TodoWrite output (☐, ☒, ◐)
    TODO_NATIVE_PATTERN.lastIndex = 0;
    while ((match = TODO_NATIVE_PATTERN.exec(line)) !== null) {
      const icon = match[1];
      const content = match[2].trim();

      // Skip if content matches exclude patterns (tool invocations, commentary)
      const shouldExclude = TODO_EXCLUDE_PATTERNS.some(pattern => pattern.test(content));
      if (shouldExclude) continue;

      // Skip if content is too short or looks like partial garbage
      if (content.length < 5) continue;

      const status = this.iconToStatus(icon);
      this.upsertTodo(content, status);
      updated = true;
    }

    if (updated) {
      this.emit('todoUpdate', this.todos);
    }
  }

  /**
   * Convert todo icon to status
   */
  private iconToStatus(icon: string): InnerTodoStatus {
    switch (icon) {
      case '✓':
      case '✅':
      case '☒':  // Claude Code checked checkbox
      case '◉':  // Filled circle (completed)
      case '●':  // Solid circle (completed)
        return 'completed';
      case '◐':  // Half-filled circle (in progress)
      case '⏳':
      case '⌛':
      case '🔄':
        return 'in_progress';
      case '☐':  // Claude Code empty checkbox
      case '○':  // Empty circle
      default:
        return 'pending';
    }
  }

  /**
   * Add or update a todo item
   */
  private upsertTodo(content: string, status: InnerTodoStatus): void {
    // Skip empty or whitespace-only content
    if (!content || !content.trim()) return;

    // Clean content: remove ANSI codes, collapse whitespace, trim
    const cleanContent = content
      .replace(ANSI_ESCAPE_PATTERN, '')  // Remove ANSI escape codes
      .replace(/\s+/g, ' ')              // Collapse whitespace
      .trim();
    if (cleanContent.length < 5) return;  // Skip very short content

    // Generate a stable ID from normalized content
    const id = this.generateTodoId(cleanContent);

    const existing = this._todos.get(id);
    if (existing) {
      // Update existing todo
      existing.status = status;
      existing.detectedAt = Date.now();
    } else {
      // Add new todo
      if (this._todos.size >= MAX_TODO_ITEMS) {
        // Remove oldest todo to make room
        const oldest = this.findOldestTodo();
        if (oldest) {
          this._todos.delete(oldest.id);
        }
      }

      this._todos.set(id, {
        id,
        content: cleanContent,
        status,
        detectedAt: Date.now(),
      });
    }
  }

  /**
   * Normalize todo content for consistent matching
   * - Collapse multiple whitespace to single space
   * - Remove trailing garbage characters
   * - Trim whitespace
   */
  private normalizeTodoContent(content: string): string {
    if (!content) return '';
    return content
      .replace(/\s+/g, ' ')           // Collapse whitespace
      .replace(/[^a-zA-Z0-9\s.,!?'"-]/g, '')  // Remove special chars (keep punctuation)
      .trim()
      .toLowerCase();
  }

  /**
   * Generate a stable ID from todo content using djb2 hash
   * Content is normalized first to prevent duplicates from terminal artifacts
   */
  private generateTodoId(content: string): string {
    if (!content) return 'todo-empty';

    // Normalize content for consistent hashing
    const normalized = this.normalizeTodoContent(content);
    if (!normalized) return 'todo-empty';

    // djb2 hash algorithm - good distribution for strings
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
      hash = hash | 0; // Convert to 32-bit integer
    }
    return `todo-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Find the oldest todo item
   */
  private findOldestTodo(): InnerTodoItem | undefined {
    let oldest: InnerTodoItem | undefined;
    for (const todo of this._todos.values()) {
      if (!oldest || todo.detectedAt < oldest.detectedAt) {
        oldest = todo;
      }
    }
    return oldest;
  }

  /**
   * Throttled cleanup - only runs every CLEANUP_THROTTLE_MS
   */
  private maybeCleanupExpiredTodos(): void {
    const now = Date.now();
    if (now - this._lastCleanupTime < CLEANUP_THROTTLE_MS) {
      return;
    }
    this._lastCleanupTime = now;
    this.cleanupExpiredTodos();
  }

  /**
   * Remove expired todo items
   */
  private cleanupExpiredTodos(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, todo] of this._todos) {
      if (now - todo.detectedAt > TODO_EXPIRY_MS) {
        toDelete.push(id);
      }
    }

    if (toDelete.length > 0) {
      for (const id of toDelete) {
        this._todos.delete(id);
      }
      this.emit('todoUpdate', this.todos);
    }
  }

  /**
   * Mark the loop as started (can be called externally)
   * Also enables the tracker if not already enabled
   */
  startLoop(completionPhrase?: string, maxIterations?: number): void {
    this.enable(); // Ensure tracker is enabled
    this._loopState.active = true;
    this._loopState.startedAt = Date.now();
    this._loopState.cycleCount = 0;
    this._loopState.maxIterations = maxIterations ?? null;
    this._loopState.elapsedHours = null;
    this._loopState.lastActivity = Date.now();
    if (completionPhrase) {
      this._loopState.completionPhrase = completionPhrase;
    }
    this.emit('loopUpdate', this.loopState);
  }

  /**
   * Update max iterations (can be called externally)
   */
  setMaxIterations(maxIterations: number | null): void {
    this._loopState.maxIterations = maxIterations;
    this._loopState.lastActivity = Date.now();
    this.emit('loopUpdate', this.loopState);
  }

  /**
   * Mark the loop as stopped
   */
  stopLoop(): void {
    this._loopState.active = false;
    this._loopState.lastActivity = Date.now();
    this.emit('loopUpdate', this.loopState);
  }

  /**
   * Clear all state (e.g., when session is cleared)
   * Resets to disabled state
   */
  clear(): void {
    this._loopState = createInitialInnerLoopState(); // This sets enabled: false
    this._todos.clear();
    this._lineBuffer = '';
    this._completionPhraseCount.clear();
    this.emit('loopUpdate', this.loopState);
    this.emit('todoUpdate', this.todos);
  }

  /**
   * Get todo completion stats
   */
  getTodoStats(): { total: number; pending: number; inProgress: number; completed: number } {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;

    for (const todo of this._todos.values()) {
      switch (todo.status) {
        case 'pending':
          pending++;
          break;
        case 'in_progress':
          inProgress++;
          break;
        case 'completed':
          completed++;
          break;
      }
    }

    return {
      total: this._todos.size,
      pending,
      inProgress,
      completed,
    };
  }

  /**
   * Restore state from persisted data
   */
  restoreState(loopState: InnerLoopState, todos: InnerTodoItem[]): void {
    // Ensure enabled flag exists (backwards compatibility)
    this._loopState = {
      ...loopState,
      enabled: loopState.enabled ?? false,  // Override after spread for backwards compat
    };
    this._todos.clear();
    for (const todo of todos) {
      this._todos.set(todo.id, { ...todo });
    }
  }
}
