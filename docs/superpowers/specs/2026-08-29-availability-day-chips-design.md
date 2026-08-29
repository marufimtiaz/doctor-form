# Availability Multi-Day Chips Design Specification

## Overview
Transform the availability date selection in the doctor survey form from a single-day dropdown per slot into clickable multi-day chips with quick presets. This allows users to easily assign multiple day names (e.g. Sat, Sun, Mon) to a single time window while maintaining full backend compatibility (converting day names to integer representation `0..6`).

## Requirements
1. **Multi-Day Selection via Chips**: Users can select one or more day chips (`Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`) for a single time range.
2. **Quick Presets**: Provide shortcut buttons (**Weekend**, **Weekdays**, **All Days**, **Clear**) to quickly toggle sets of day chips.
3. **Day Name Interface**: The frontend schema and UI components operate using day name strings (`"Sat"`, `"Sun"`, `"Mon"`, `"Tue"`, `"Wed"`, `"Thu"`, `"Fri"`).
4. **Backend Schema Mapping**: The Zod schema (`surveySchema`) transforms string day names to standard integers (`Sat`=5, `Sun`=6, `Mon`=0, `Tue`=1, `Wed`=2, `Thu`=3, `Fri`=4) and flattens multi-day slot items into separate `{ day_of_week, start_time, end_time }` entries expected by the API.

## Detailed Component Specifications

### 1. Frontend Schema (`frontend/src/schemas/survey.ts`)
- Define constant `DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const`.
- Define mapping `DAY_NAME_TO_INT`:
  - `Sat`: 5
  - `Sun`: 6
  - `Mon`: 0
  - `Tue`: 1
  - `Wed`: 2
  - `Thu`: 3
  - `Fri`: 4
- Update `slotSchema`:
  - `days`: `z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day.")`
  - `start_time`: `z.string().min(1, "Start time is required.")`
  - `end_time`: `z.string().min(1, "End time is required.")`
  - Refinement: `end_time > start_time`
- Update `surveySchema`:
  - In `slots`, validate array of `slotSchema`.
  - Add `.transform()` (or update schema output transformation) so that each slot entry with multiple selected `days` flattens into individual `{ day_of_week: number, start_time: string, end_time: string }` objects required by backend `SlotIn`.
- Update `emptySlot()`:
  - Default: `{ days: ["Sat"], start_time: "17:00", end_time: "20:00" }`.

### 2. UI Component (`frontend/src/components/SlotEditor.tsx`)
- Render a list of slot field arrays using `useFieldArray`.
- For each slot item:
  - **Quick Presets Bar**:
    - **Weekend**: Sets `days` to `["Sat", "Sun"]`
    - **Weekdays**: Sets `days` to `["Mon", "Tue", "Wed", "Thu"]`
    - **All Days**: Sets `days` to `["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]`
    - **Clear**: Empties selected `days`
  - **Day Chips Container**:
    - Clickable toggle chips/badges for each day in `DAY_NAMES`.
    - Clicking an unselected day adds it to `days`; clicking a selected day removes it.
    - Active day chips display with primary visual styling (`Button` variant `default` or active badge styling). Unselected day chips display with `outline` or `ghost` styling.
  - **Time Input Fields**: `start_time` and `end_time` inputs.
  - **Validation Errors**: Render form messages for missing days or invalid time ranges.

### 3. Tests (`frontend/src/schemas/survey.test.ts`)
- Update schema test suite:
  - Validate that `days: []` raises validation error `"Select at least one day."`.
  - Validate that providing `days: ["Sat", "Sun"]` transforms into array of objects with `day_of_week: 5` and `day_of_week: 6`.
  - Verify all existing location, phone, and number tests continue to pass cleanly.

## Non-Functional Requirements & Isolation
- No changes required to backend code, database tables, or Alembic migrations.
- Complete isolation of day name transformation within the frontend Zod schema.
