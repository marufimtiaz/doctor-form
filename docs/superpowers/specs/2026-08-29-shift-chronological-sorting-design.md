# Shift Chronological Auto-Sorting & Boundary Filtering Design Specification

## Overview
Enforce chronological ordering and strict non-overlapping interval boundaries between Shift 1 and Shift 2 within a slot group:
1. **Chronological Auto-Sort**:
   - Shift 1 is always the earlier shift (`start_time_1 < start_time_2`).
   - If user edits times or adds a new shift, shifts are automatically sorted by `start_time`.
2. **Boundary Filtering**:
   - Shift 1 End Time (`end_time_1`) cannot exceed Shift 2 Start Time (`start_time_2`).
   - Shift 2 Start Time (`start_time_2`) cannot precede Shift 1 End Time (`end_time_1`).
3. **Timeline Drag Knob Clamping**:
   - Left handle knob of Shift 2 is clamped to not cross Shift 1's right handle knob.
   - Right handle knob of Shift 1 is clamped to not cross Shift 2's left handle knob.

## Implementation Details (`frontend/src/components/SlotEditor.tsx`)
- `sortRanges(ranges)` helper function: sorts ranges by `start_time`.
- `TIME_OPTIONS` dropdown filtering:
  - `start_time` and `end_time` dropdown options are filtered based on adjacent shift boundaries.
- Form validation: Zod schema and UI prevent invalid intervals. Zero backend API or DB changes.
