/**
 * @fileoverview Persistent JSON state storage for Claudeman.
 *
 * This module provides the StateStore class which persists application state
 * to `~/.claudeman/state.json` with debounced writes to prevent excessive disk I/O.
 *
 * State is split into two files:
 * - `state.json`: Main app state (sessions, tasks, config)
 * - `state-inner.json`: Inner loop state (todos, Ralph loop state per session)
 *
 * The separation reduces write frequency since inner loop state changes rapidly
 * during Ralph Wiggum loops.
 *
 * @module state-store
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppState, createInitialState, InnerSessionState, createInitialInnerSessionState } from './types.js';

/** Debounce delay for batching state writes (ms) */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Persistent JSON state storage with debounced writes.
 *
 * State is automatically loaded on construction and saved with 500ms
 * debouncing to batch rapid updates into single disk writes.
 *
 * @example
 * ```typescript
 * const store = new StateStore();
 *
 * // Read state
 * const sessions = store.getState().sessions;
 *
 * // Modify and save
 * store.getState().sessions[id] = sessionState;
 * store.save();  // Debounced - won't write immediately
 *
 * // Force immediate write
 * store.saveNow();
 * ```
 */
export class StateStore {
  private state: AppState;
  private filePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private dirty: boolean = false;

  // Inner state storage (separate from main state to reduce write frequency)
  private innerStates: Map<string, InnerSessionState> = new Map();
  private innerStatePath: string;
  private innerStateSaveTimeout: NodeJS.Timeout | null = null;
  private innerStateDirty: boolean = false;

  constructor(filePath?: string) {
    this.filePath = filePath || join(homedir(), '.claudeman', 'state.json');
    this.innerStatePath = this.filePath.replace('.json', '-inner.json');
    this.state = this.load();
    this.state.config.stateFilePath = this.filePath;
    this.loadInnerStates();
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): AppState {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data) as Partial<AppState>;
        // Merge with initial state to ensure all fields exist
        const initial = createInitialState();
        return {
          ...initial,
          ...parsed,
          sessions: { ...parsed.sessions },
          tasks: { ...parsed.tasks },
          ralphLoop: { ...initial.ralphLoop, ...parsed.ralphLoop },
          config: { ...initial.config, ...parsed.config },
        };
      }
    } catch (err) {
      console.error('Failed to load state, using initial state:', err);
    }
    return createInitialState();
  }

  // Debounced save - batches multiple updates into a single write
  save(): void {
    this.dirty = true;
    if (this.saveTimeout) {
      return; // Already scheduled
    }
    this.saveTimeout = setTimeout(() => {
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Immediate save - use when you need guaranteed persistence
  saveNow(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    this.ensureDir();
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  // Flush any pending saves (call before shutdown)
  flush(): void {
    this.saveNow();
  }

  getState(): AppState {
    return this.state;
  }

  getSessions() {
    return this.state.sessions;
  }

  getSession(id: string) {
    return this.state.sessions[id] || null;
  }

  setSession(id: string, session: AppState['sessions'][string]) {
    this.state.sessions[id] = session;
    this.save();
  }

  removeSession(id: string) {
    delete this.state.sessions[id];
    this.save();
  }

  getTasks() {
    return this.state.tasks;
  }

  getTask(id: string) {
    return this.state.tasks[id] || null;
  }

  setTask(id: string, task: AppState['tasks'][string]) {
    this.state.tasks[id] = task;
    this.save();
  }

  removeTask(id: string) {
    delete this.state.tasks[id];
    this.save();
  }

  getRalphLoopState() {
    return this.state.ralphLoop;
  }

  setRalphLoopState(ralphLoop: Partial<AppState['ralphLoop']>) {
    this.state.ralphLoop = { ...this.state.ralphLoop, ...ralphLoop };
    this.save();
  }

  getConfig() {
    return this.state.config;
  }

  setConfig(config: Partial<AppState['config']>) {
    this.state.config = { ...this.state.config, ...config };
    this.save();
  }

  reset(): void {
    this.state = createInitialState();
    this.state.config.stateFilePath = this.filePath;
    this.innerStates.clear();
    this.saveNow(); // Immediate save for reset operations
    this.saveInnerStatesNow();
  }

  // ========== Inner State Methods ==========

  private loadInnerStates(): void {
    try {
      if (existsSync(this.innerStatePath)) {
        const data = readFileSync(this.innerStatePath, 'utf-8');
        const parsed = JSON.parse(data) as Record<string, InnerSessionState>;
        for (const [sessionId, state] of Object.entries(parsed)) {
          this.innerStates.set(sessionId, state);
        }
      }
    } catch (err) {
      console.error('Failed to load inner states:', err);
    }
  }

  // Debounced save for inner states
  private saveInnerStates(): void {
    this.innerStateDirty = true;
    if (this.innerStateSaveTimeout) {
      return; // Already scheduled
    }
    this.innerStateSaveTimeout = setTimeout(() => {
      this.saveInnerStatesNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Immediate save for inner states
  private saveInnerStatesNow(): void {
    if (this.innerStateSaveTimeout) {
      clearTimeout(this.innerStateSaveTimeout);
      this.innerStateSaveTimeout = null;
    }
    if (!this.innerStateDirty) {
      return;
    }
    this.innerStateDirty = false;
    this.ensureDir();
    const data: Record<string, InnerSessionState> = {};
    for (const [sessionId, state] of this.innerStates) {
      data[sessionId] = state;
    }
    writeFileSync(this.innerStatePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getInnerState(sessionId: string): InnerSessionState | null {
    return this.innerStates.get(sessionId) || null;
  }

  setInnerState(sessionId: string, state: InnerSessionState): void {
    this.innerStates.set(sessionId, state);
    this.saveInnerStates();
  }

  updateInnerState(sessionId: string, updates: Partial<InnerSessionState>): InnerSessionState {
    let state = this.innerStates.get(sessionId);
    if (!state) {
      state = createInitialInnerSessionState(sessionId);
    }
    state = { ...state, ...updates, lastUpdated: Date.now() };
    this.innerStates.set(sessionId, state);
    this.saveInnerStates();
    return state;
  }

  removeInnerState(sessionId: string): void {
    if (this.innerStates.has(sessionId)) {
      this.innerStates.delete(sessionId);
      this.saveInnerStates();
    }
  }

  getAllInnerStates(): Map<string, InnerSessionState> {
    return new Map(this.innerStates);
  }

  // Flush all pending saves (call before shutdown)
  flushAll(): void {
    this.saveNow();
    this.saveInnerStatesNow();
  }
}

// Singleton instance
let storeInstance: StateStore | null = null;

export function getStore(filePath?: string): StateStore {
  if (!storeInstance) {
    storeInstance = new StateStore(filePath);
  }
  return storeInstance;
}
