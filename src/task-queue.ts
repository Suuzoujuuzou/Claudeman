/**
 * @fileoverview Task queue for managing Claude prompts and operations
 *
 * Provides a priority queue for tasks with:
 * - Priority-based ordering (higher priority first)
 * - Dependency tracking between tasks
 * - State persistence via StateStore
 * - Session assignment for task execution
 *
 * @module task-queue
 */

import { EventEmitter } from 'node:events';
import { Task, CreateTaskOptions } from './task.js';
import { getStore } from './state-store.js';
import { TaskState } from './types.js';

/**
 * Events emitted by TaskQueue
 */
export interface TaskQueueEvents {
  /** Fired when a task is added to the queue */
  taskAdded: (task: Task) => void;
  /** Fired when a task is removed from the queue */
  taskRemoved: (taskId: string) => void;
  /** Fired when a task's state changes */
  taskUpdated: (task: Task) => void;
}

/**
 * Priority queue for managing tasks with dependency support.
 *
 * @description
 * Tasks are ordered by priority (descending) then creation time (ascending).
 * Dependencies can be specified to ensure tasks run in correct order.
 *
 * @extends EventEmitter
 */
export class TaskQueue extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private store = getStore();

  /** Creates a new TaskQueue and loads persisted tasks. */
  constructor() {
    super();
    this.loadFromStore();
  }

  private loadFromStore(): void {
    const storedTasks = this.store.getTasks();
    for (const [id, state] of Object.entries(storedTasks)) {
      const task = Task.fromState(state);
      this.tasks.set(id, task);
    }
  }

  /** Adds a new task to the queue. */
  addTask(options: CreateTaskOptions): Task {
    const task = new Task(options);
    this.tasks.set(task.id, task);
    this.store.setTask(task.id, task.toState());
    this.emit('taskAdded', task);
    return task;
  }

  /** Gets a task by ID. */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Removes a task by ID. Returns true if removed. */
  removeTask(id: string): boolean {
    const removed = this.tasks.delete(id);
    if (removed) {
      this.store.removeTask(id);
      this.emit('taskRemoved', id);
    }
    return removed;
  }

  /** Updates a task and persists the change. */
  updateTask(task: Task): void {
    this.tasks.set(task.id, task);
    this.store.setTask(task.id, task.toState());
    this.emit('taskUpdated', task);
  }

  /** Gets all tasks in the queue. */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /** Gets pending tasks sorted by priority then creation time. */
  getPendingTasks(): Task[] {
    return this.getAllTasks()
      .filter((t) => t.isPending())
      .sort((a, b) => {
        // Sort by priority (higher first), then by creation time (older first)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      });
  }

  /** Gets tasks currently being executed. */
  getRunningTasks(): Task[] {
    return this.getAllTasks().filter((t) => t.isRunning());
  }

  /** Gets successfully completed tasks. */
  getCompletedTasks(): Task[] {
    return this.getAllTasks().filter((t) => t.isCompleted());
  }

  /** Gets tasks that failed execution. */
  getFailedTasks(): Task[] {
    return this.getAllTasks().filter((t) => t.isFailed());
  }

  /** Returns true if there's a task ready for execution. */
  hasNext(): boolean {
    return this.getNextAvailable() !== null;
  }

  /** Gets the next task ready for execution (with satisfied dependencies). */
  getNextAvailable(): Task | null {
    const pending = this.getPendingTasks();

    for (const task of pending) {
      if (this.areDependenciesSatisfied(task)) {
        return task;
      }
    }

    return null;
  }

  /** Alias for getNextAvailable(). */
  next(): Task | null {
    return this.getNextAvailable();
  }

  private areDependenciesSatisfied(task: Task): boolean {
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || !dep.isCompleted()) {
        return false;
      }
    }
    return true;
  }

  /** Gets all tasks assigned to a specific session. */
  getTasksBySession(sessionId: string): Task[] {
    return this.getAllTasks().filter((t) => t.assignedSessionId === sessionId);
  }

  /** Gets the currently running task for a session, if any. */
  getRunningTaskForSession(sessionId: string): Task | null {
    return this.getAllTasks().find(
      (t) => t.isRunning() && t.assignedSessionId === sessionId
    ) || null;
  }

  /** Gets counts of tasks by status. */
  getCount(): { total: number; pending: number; running: number; completed: number; failed: number } {
    const tasks = this.getAllTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.isPending()).length,
      running: tasks.filter((t) => t.isRunning()).length,
      completed: tasks.filter((t) => t.isCompleted()).length,
      failed: tasks.filter((t) => t.isFailed()).length,
    };
  }

  /** Removes all completed tasks. Returns count removed. */
  clearCompleted(): number {
    let count = 0;
    for (const task of this.getAllTasks()) {
      if (task.isCompleted()) {
        this.removeTask(task.id);
        count++;
      }
    }
    return count;
  }

  /** Removes all failed tasks. Returns count removed. */
  clearFailed(): number {
    let count = 0;
    for (const task of this.getAllTasks()) {
      if (task.isFailed()) {
        this.removeTask(task.id);
        count++;
      }
    }
    return count;
  }

  /** Removes all tasks from the queue. Returns count removed. */
  clearAll(): number {
    const count = this.tasks.size;
    for (const id of this.tasks.keys()) {
      this.store.removeTask(id);
    }
    this.tasks.clear();
    return count;
  }

  /** Gets tasks from persistent storage. */
  getStoredTasks(): Record<string, TaskState> {
    return this.store.getTasks();
  }
}

// Singleton instance
let queueInstance: TaskQueue | null = null;

/** Gets or creates the singleton TaskQueue instance. */
export function getTaskQueue(): TaskQueue {
  if (!queueInstance) {
    queueInstance = new TaskQueue();
  }
  return queueInstance;
}
