# Multi-Segment Time Range Slider Design Specification

## Overview
Enhance the availability slot selection in the doctor survey form with a **Multi-Segment Time Range Slider**. A single slot group allows selecting multiple days of the week (`Sat`, `Sun`, `Mon`, etc.) and adding multiple time range segments (e.g. Morning 09:00 AM – 12:00 PM and Evening 05:00 PM – 08:00 PM) on a visual timeline bar with 30-minute tick marks.

Upon submission, all `(days × time ranges)` combinations are flattened into individual `{ day_of_week, start_time, end_time }` entries matching the existing backend database schema.

## Requirements
1. **Day Selection Chips**: `Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri` toggle chips and preset shortcuts (**Weekend**, **Weekdays**, **All Days**, **Clear**).
2. **Multi-Segment Visual Timeline**:
   - 24-hour visual timeline track (8:00 AM to 11:00 PM) marked with **30-minute tick marks**.
   - Multiple time range segments highlighted visually on the timeline track.
3. **Multiple Time Ranges Per Group**:
   - Each time range segment has start and end 12-hour time dropdown selectors (`09:00 AM`, `09:30 AM`, ...), a live duration badge (e.g. `⏱️ 3 hrs`), and a delete button (`✕`).
   - Quick preset buttons (`Evening 5–8 PM`, `Night 7–10 PM`, `Morning 9 AM–1 PM`).
   - `+ Add Time Range` button to add additional time shifts (e.g. Morning + Evening) to the same day group.
4. **Multiple Slot Groups**:
   - `+ Add Slot Group` button to create additional slot cards if different days have different schedules.
5. **Backend Database Compatibility**:
   - `toBackendSlots(slots)` flattens all `(days × ranges)` combinations into individual `{ day_of_week: number, start_time: string, end_time: string }` rows stored in PostgreSQL. Zero backend database schema changes required.

## Detailed Component Specifications

### 1. Frontend Schema (`frontend/src/schemas/survey.ts`)
- Define `timeRangeSchema`:
  - `start_time`: `z.string().min(1, "Start time is required.")`
  - `end_time`: `z.string().min(1, "End time is required.")`
  - Refinement: `end_time > start_time` ("End must be after start.")
- Define `slotSchema`:
  - `days`: `z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day.")`
  - `ranges`: `z.array(timeRangeSchema).min(1, "Add at least one time range.")`
- Helper `toBackendSlots(slots)`:
  - Iterates through `slots`, `days`, and `ranges` to produce a flat array of `{ day_of_week: number, start_time: string, end_time: string }`.

### 2. UI Component (`frontend/src/components/SlotEditor.tsx`)
- Renders array of slot groups using `useFieldArray({ control, name: "slots" })`.
- For each slot group:
  - Header with slot index, day chips (`Sat`..`Fri`), and quick preset shortcuts.
  - **Visual Timeline Component**:
    - Renders 24-hour timeline bar with major ticks (hours) and minor ticks (30-min intervals).
    - Renders visual highlight bars for each range in `ranges`.
  - **Time Range Cards**:
    - Render 12-hour dropdown selectors for `start_time` and `end_time` (30-minute intervals from 06:00 to 23:00).
    - Calculate and render live duration badge (e.g., `⏱️ 3 hrs`).
    - Remove button (`✕`) for deleting individual time ranges.
  - Action button: `+ Add Time Range`.
- Bottom action button: `+ Add Slot Group`.

### 3. Tests (`frontend/src/schemas/survey.test.ts`)
- Test validation requiring at least 1 day per slot and 1 range per slot.
- Test `toBackendSlots` expanding 2 days × 2 ranges into 4 individual backend integer slot items.
