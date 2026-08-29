# Availability Schedule UI/UX Overhaul Design Specification

## Overview
Elevate the availability schedule selection in the doctor survey form with a modern visual UI overhaul featuring:
1. Real-time header summary stats (`⏱️ Weekly Hours`, `🗓️ Active Days`, `👥 Estimated Patient Capacity`).
2. Color-coded shift segments (Morning, Afternoon, Evening, Night).
3. Overlap conflict detection with visual warning stripes and alert messages.
4. Interactive hover sync between shift row cards and the timeline track.
5. Quick `-30m` / `+30m` adjustment step buttons for instant time tweaking.

Full backend compatibility (`toBackendSlots`) is preserved with zero database or API schema changes.

## Component Design (`frontend/src/components/SlotEditor.tsx`)

### 1. Header Summary Stats Bar
- Calculates:
  - `totalDays`: Number of unique days selected across all slot groups.
  - `totalWeeklyMins`: Sum of all shift durations multiplied by the number of active days per group.
  - `weeklyCapacity`: Estimated total weekly patients based on `avg_duration_min`.
- Displays formatted summary badges at the top of the Availability fieldset.

### 2. Color-Coded Shift System
- Helper `getShiftColor(start_time)`:
  - `06:00` to `11:59` → **Morning**: Amber (`bg-amber-500`, `border-amber-500`)
  - `12:00` to `16:59` → **Afternoon**: Sky Blue (`bg-sky-500`, `border-sky-500`)
  - `17:00` to `19:59` → **Evening**: Indigo (`bg-indigo-600`, `border-indigo-600`)
  - `20:00` to `23:00` → **Night**: Slate (`bg-slate-800`, `border-slate-800`)
- Timeline track segments and shift cards feature matching color accents.

### 3. Overlap Conflict Detector
- Helper `detectOverlaps(ranges)`:
  - Compares time intervals `[start_time, end_time]` within each slot group.
  - Returns overlapping time intervals.
- If overlap exists:
  - Renders warning alert: `⚠️ Shifts overlap by X mins (HH:MM - HH:MM)`.
  - Timeline track renders overlapping range in diagonal amber/red stripes (`bg-destructive/80`).

### 4. Interactive Hover Sync
- Hover state `hoveredShift: { groupIndex: number, rangeIndex: number } | null`.
- Hovering on a Shift Row applies `ring-2 ring-primary` to the timeline segment.

### 5. Quick `-30m` / `+30m` Adjustment Handles
- Step buttons for Start and End times:
  - Adjusts time by ±30 minutes in 1 click, bounded between `06:00` and `23:00`.

## Testing & Verification
- Verify Zod schema unit tests (`npm test`).
- Verify TypeScript compilation (`npx tsc --noEmit`).
- Verify production build (`npm run build`).
