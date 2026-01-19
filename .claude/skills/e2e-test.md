# E2E Testing with Agent-Browser

This skill uses agent-browser to perform end-to-end testing of the Claudeman web interface.

## Usage

When this skill is invoked, run comprehensive E2E tests on the web interface.

## Test Plan

### Prerequisites
1. Ensure the server is running: `npm run dev` or `claudeman web`
2. Default URL: http://localhost:3000

### Test Execution

Use `npx agent-browser` to run the following tests:

```bash
# Test 1: Connection and Initial Load
npx agent-browser open http://localhost:3000
npx agent-browser wait --load networkidle
npx agent-browser snapshot
npx agent-browser screenshot /tmp/claudeman-test-1-initial.png

# Test 2: Font Controls (A+/A-)
npx agent-browser find text "A-" click
npx agent-browser wait 500
npx agent-browser find text "A+" click
npx agent-browser find text "A+" click
npx agent-browser screenshot /tmp/claudeman-test-2-font.png

# Test 3: Tab Count Stepper
npx agent-browser find text "+" click  # Increment tab count
npx agent-browser find text "+" click
npx agent-browser find text "−" click  # Decrement
npx agent-browser screenshot /tmp/claudeman-test-3-tabcount.png

# Test 4: Create Claude Session
npx agent-browser find text "Run Claude" click
npx agent-browser wait 2000
npx agent-browser snapshot
npx agent-browser screenshot /tmp/claudeman-test-4-session.png

# Test 5: Open Session Options (gear icon on tab)
npx agent-browser snapshot  # Get element refs
# Find and click the gear icon on the session tab
npx agent-browser screenshot /tmp/claudeman-test-5-options.png

# Test 6: Test Respawn Settings in Modal
# Should see: Update Prompt, Idle Timeout, Step Delay, Duration, checkboxes
npx agent-browser screenshot /tmp/claudeman-test-6-respawn.png

# Test 7: Monitor Panel
npx agent-browser find text "Monitor" click
npx agent-browser wait 500
npx agent-browser snapshot
npx agent-browser screenshot /tmp/claudeman-test-7-monitor.png

# Test 8: Close Monitor Panel
npx agent-browser find text "×" click
npx agent-browser screenshot /tmp/claudeman-test-8-closed.png

# Cleanup
npx agent-browser close
```

### Expected Results

1. **Initial Load**: Page loads with header containing: logo, session tabs, font controls (A-/14/A+), connection status, tokens display, settings gear
2. **Font Controls**: Font controls should be to the LEFT of connection status
3. **Tab Count Stepper**: Nice stepper with −/number/+ buttons, not just a plain number input
4. **Session Creation**: Session tab appears, terminal shows Claude starting
5. **Session Options**: Modal opens with session name, directory, AND respawn settings (Update Prompt, timeouts, checkboxes)
6. **Monitor Panel**: Shows "Screen Sessions" and "Background Tasks" sections
7. **Respawn Settings**: All settings integrated into the session options modal, NO separate bottom panel

### Verification Checklist

- [ ] Font controls positioned left of connection status
- [ ] Tab count has nice stepper buttons (−/+)
- [ ] No "Respawn Settings" button in footer
- [ ] Respawn settings appear in Session Options modal
- [ ] Monitor panel opens and shows both sections
- [ ] Sessions are wrapped in GNU screen (check with `screen -ls`)
