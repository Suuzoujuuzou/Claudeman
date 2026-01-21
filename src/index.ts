#!/usr/bin/env node
/**
 * @fileoverview Claudeman CLI entry point
 *
 * This is the main executable entry point for the Claudeman CLI.
 * It sets up global error handlers and invokes the CLI parser.
 *
 * @module index
 */

import { program } from './cli.js';

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Run CLI
program.parse();
