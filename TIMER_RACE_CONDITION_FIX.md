# Timer Race Condition Fix

## Problem Summary

Race condition in `summoner-cooldown.ts` when multiple rapid key presses caused:
- ❌ Duplicate timers running simultaneously
- ❌ Lost timer state (persisted vs in-memory mismatch)
- ❌ Incorrect remaining time displayed
- ❌ Crash potential from uncaught async errors

## Root Cause

**Concurrent Read-Modify-Write** without synchronization:
```typescript
// BAD (Before Fix):
const globalSettings = await getGlobalSettings();  // Read
spellCell.isTimerRunning = true;                   // Modify
await setGlobalSettings(globalSettings);           // Write
this.startTimerForCell(...);                       // Side effect

// Problem: Multiple onKeyDown calls execute this sequence in parallel
```

## Solution Implemented

### 1. Mutex Lock Pattern

Added per-cell locking to ensure atomic operations:

```typescript
// Added to SummonerCooldown class:
private pendingOperations: Map<string, Promise<void>> = new Map();

private async withLock<T>(cellKey: string, operation: () => Promise<T>): Promise<T> {
    await this.acquireLock(cellKey);

    const lockPromise = new Promise<void>((resolve) => { ... });
    this.pendingOperations.set(cellKey, lockPromise);

    try {
        return await operation();
    } finally {
        this.pendingOperations.delete(cellKey);
        resolver();
    }
}
```

### 2. Atomic Timer Operations

Timer start/stop now wrapped in lock:

```typescript
// GOOD (After Fix):
await this.withLock(timerKey, async () => {
    // Re-read inside lock for freshness
    const globalSettings = await getGlobalSettings();

    // Modify state
    spellCell.isTimerRunning = true;

    // Persist BEFORE starting timer
    await setGlobalSettings(globalSettings);

    // Update UI
    await ev.action.setImage(...);

    // Now safe to start timer
    this.startTimerForCell(...);
});
```

### 3. Error Handling

Added try-catch with state restoration:

```typescript
try {
    // Timer operations...
} catch (error) {
    streamDeck.logger.error(`Error handling timer: ${error}`);
    // Restore consistent state
    freshCell.isTimerRunning = false;
    timerManager.clearTimer(timerKey);
    await setGlobalSettings(freshSettings);
}
```

### 4. Callback Safety

Protected timer callbacks from uncaught errors:

```typescript
onTick: (remaining) => {
    try {
        actionRef?.setTitle(remaining.toString()).catch(err => {
            streamDeck.logger.warn(`Failed to update: ${err}`);
        });
    } catch (error) {
        streamDeck.logger.error(`Timer tick error: ${error}`);
    }
}
```

## Testing Plan

### Manual Testing

1. **Rapid Key Presses Test**
   - [ ] Lock a spell to a role
   - [ ] Rapidly press the spell key 10+ times in 2 seconds
   - [ ] ✅ Expected: Only ONE timer starts, no duplicates
   - [ ] ✅ Expected: No console errors

2. **Start/Stop Spam Test**
   - [ ] Start a timer (press once)
   - [ ] Immediately press again to stop
   - [ ] Repeat 20 times rapidly
   - [ ] ✅ Expected: Timer toggles correctly, no stale state

3. **Page Switch During Timer**
   - [ ] Start a timer on Row 0, Column 0
   - [ ] Switch to different page (hide the action)
   - [ ] Switch back while timer is running
   - [ ] ✅ Expected: Timer resumes from correct remaining time
   - [ ] ✅ Expected: Image shows "Down" state

4. **Concurrent Column Test**
   - [ ] Start timers on all 4 columns simultaneously
   - [ ] Rapidly press keys on different columns
   - [ ] ✅ Expected: Each column's timer independent, no cross-talk

5. **Unlock During Timer**
   - [ ] Start a timer
   - [ ] Unlock the champion dial while timer running
   - [ ] ✅ Expected: Timer stops and resets
   - [ ] ✅ Expected: Spell unlocked for selection

### Automated Testing (Future)

```typescript
// Test suite to add:
describe('SummonerCooldown Timer Operations', () => {
    test('prevents duplicate timers on rapid presses', async () => {
        // Simulate 10 rapid key presses
        // Assert only 1 timer running
    });

    test('maintains consistent state across settings saves', async () => {
        // Verify isTimerRunning matches timerManager.isRunning()
    });

    test('recovers from errors gracefully', async () => {
        // Inject settings write failure
        // Verify state restored
    });
});
```

## Code Changes Summary

**Files Modified:**
- `src/actions/summoner-cooldown.ts` (+80 lines)
  - Added `pendingOperations` Map
  - Added `acquireLock()` and `withLock()` methods
  - Refactored `onKeyDown()` to use lock
  - Added error handling to callbacks
  - Replaced `console.log` with `streamDeck.logger`

**Performance Impact:**
- ✅ Minimal: Locks only block concurrent operations on the SAME cell
- ✅ Different columns process in parallel (independent locks)
- ✅ Lock acquisition is fast (async wait, no spinning)

## Remaining Considerations

### 1. CDR Change During Timer
**Current Behavior:** CDR change doesn't affect running timer until completion.

**Future Enhancement:** Could add live CDR adjustment:
```typescript
// In SummonerCDR.onKeyDown():
if (globalSettings.spellsRow0?.[currentCol]?.isTimerRunning) {
    // Recalculate remaining time with new CDR
    const elapsed = originalDuration - timerManager.getRemaining(timerKey);
    const newDuration = getReducedCooldown(baseCooldown, newCDR);
    const newRemaining = Math.max(0, newDuration - elapsed);
    // Restart timer with newRemaining
}
```

### 2. Champion Switch During Timer
**Current Behavior:** Switching champion clears timers (CORRECT).

**Status:** ✅ Already handled in [champion-dial.ts:87-111](src/actions/champion-dial.ts#L87-L111)

### 3. Plugin Restart Recovery
**Current Behavior:** Timers lost on plugin restart (Stream Deck limitation).

**Possible Enhancement:** Store `startTimestamp` in global settings, resume on plugin load:
```typescript
// In plugin.ts startup:
for (const cell of allSpellCells) {
    if (cell.isTimerRunning && cell.startTimestamp) {
        const elapsed = (Date.now() - cell.startTimestamp) / 1000;
        const remaining = Math.max(0, cell.duration - elapsed);
        if (remaining > 0) {
            timerManager.startTimer(...);
        }
    }
}
```

## Deployment Checklist

- [x] Code changes implemented
- [ ] Manual testing completed
- [ ] No console errors in logs
- [ ] Test rapid key presses (10+ times)
- [ ] Test page switching during timers
- [ ] Test all 4 columns independently
- [ ] Verify timer accuracy (60s countdown takes ~60s real time)
- [ ] Check memory usage (no timer leak)
- [ ] Build and install plugin: `npm run build`
- [ ] Test on actual Stream Deck hardware
- [ ] Merge to main branch

## Verification Commands

```bash
# Build and test
npm run build

# Watch mode with auto-restart
npm run watch

# Check for TypeScript errors
npx tsc --noEmit

# View logs in real-time
streamdeck logs com.dt.summonercooldowns
```

## Success Criteria

✅ **Race Condition Eliminated:**
- No duplicate timers possible
- Consistent state between global settings and in-memory timers

✅ **Error Resilience:**
- All async operations protected by try-catch
- State restored on errors

✅ **User Experience:**
- Rapid key presses handled smoothly
- No UI glitches or freezes
- Timers survive page switches

---

**Implementation Date:** 2026-02-12
**Status:** ✅ Complete, Ready for Testing
**Priority:** 🔴 Critical Fix
