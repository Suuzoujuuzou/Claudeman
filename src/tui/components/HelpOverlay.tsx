/**
 * @fileoverview HelpOverlay component
 *
 * Full-screen help overlay displaying all TUI keyboard shortcuts.
 *
 * @description
 * Shows a comprehensive reference of keyboard shortcuts organized by context:
 * - Start Screen: Session list navigation and actions
 * - Main View - Navigation: Tab switching and screen navigation
 * - Main View - Session Management: Create, close, kill sessions
 * - General: Help toggle and exit
 *
 * Dismissible with Escape, q, or ? keys.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HelpOverlayProps {
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ key: string; description: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Start Screen - Sessions',
    shortcuts: [
      { key: '\u2191/\u2193', description: 'Navigate list' },
      { key: 'Enter', description: 'Tab switcher \u2192 full attach' },
      { key: 'a', description: 'Direct attach (skip tab menu)' },
      { key: 'd', description: 'Delete/kill selected session' },
      { key: 'D (Shift+d)', description: 'Delete ALL screens & Claude processes' },
      { key: 'c', description: 'Switch to cases view' },
      { key: 'n', description: 'Quick-start new session' },
      { key: 'r', description: 'Refresh list' },
      { key: 'q', description: 'Quit' },
    ],
  },
  {
    title: 'Start Screen - Cases',
    shortcuts: [
      { key: '\u2191/\u2193', description: 'Navigate list' },
      { key: 'Enter', description: 'Start Claude session with case' },
      { key: 'h', description: 'Start Shell session with case' },
      { key: 'm', description: 'Multi-start (1-20 sessions)' },
      { key: 'n', description: 'Create new case' },
      { key: 's', description: 'Switch to sessions view' },
      { key: 'r', description: 'Refresh list' },
    ],
  },
  {
    title: 'Tab Switcher Menu',
    shortcuts: [
      { key: '1-9', description: 'Select and attach to session N' },
      { key: 'Enter', description: 'Attach to current session' },
      { key: 'q/Esc', description: 'Return to TUI start screen' },
      { key: 'Ctrl+A D', description: '(While attached) Detach to menu' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { key: 'Ctrl+H', description: 'Toggle this help' },
      { key: 'Ctrl+C', description: 'Exit TUI' },
    ],
  },
];

/**
 * Help overlay component displaying keyboard shortcuts reference.
 *
 * @description
 * Renders a full-screen overlay with categorized keyboard shortcuts.
 * Uses consistent styling with bordered header and grouped sections.
 *
 * @param props - Component props
 * @param props.onClose - Callback invoked when overlay should close
 * @returns The help overlay element
 */
export function HelpOverlay({ onClose: _onClose }: HelpOverlayProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={2}>
      {/* Header */}
      <Box
        borderStyle="double"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
        justifyContent="center"
      >
        <Text bold color="cyan">
          Keyboard Shortcuts
        </Text>
      </Box>

      {/* Shortcut groups */}
      {SHORTCUT_GROUPS.map((group, groupIndex) => (
        <Box key={groupIndex} flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            {group.title}
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {group.shortcuts.map((shortcut, index) => (
              <Box key={index}>
                <Text color="green">{shortcut.key.padEnd(20)}</Text>
                <Text>{shortcut.description}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      ))}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>Press Escape or q to close</Text>
      </Box>
    </Box>
  );
}
