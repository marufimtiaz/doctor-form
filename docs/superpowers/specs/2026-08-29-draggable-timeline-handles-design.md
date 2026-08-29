# Interactive Draggable Timeline Handles Design Specification

## Overview
Enhance the timeline track in `SlotEditor` with **Interactive Draggable Handles** for time ranges, along with a smart **`+ Add Handle`** discovery button.

## Requirements
1. **Interactive Draggable Handles on Timeline Track**:
   - Each time shift range renders two draggable handle knobs on the timeline track:
     - Left Knob (Start Time handle)
     - Right Knob (End Time handle)
   - Pointer dragging (`onPointerDown`, `onPointerMove`, `onPointerUp`) converts track X-percentage into 30-minute time values (between 08:00 AM and 11:00 PM).
   - Real-time synchronization with React Hook Form state, 12-hour dropdown selectors, duration badges, and weekly header summary stats.
2. **`+ Add Handle` Button (Right of Timeline Bar)**:
   - Positioned to the right of the visual timeline track.
   - Enforces a **maximum of 2 handle pairs** (2 shift ranges) per slot group.
   - Smart Empty Space Search:
     - Scans 30-minute slots between 08:00 AM and 11:00 PM.
     - Identifies unassigned 30-minute intervals not covered by existing handle pairs.
     - If no free slot exists, no new handle is added.
     - If free slots exist, picks the free 30-minute interval farthest from existing shifts and initializes a new handle pair there.
3. **Backend & Test Compatibility**:
   - 100% compatible with existing `surveySchema` and `toBackendSlots`. Zero database changes.

## Detailed Component Specifications (`frontend/src/components/SlotEditor.tsx`)
- Mouse & Touch Pointer Capture: `setPointerCapture` on drag start, `releasePointerCapture` on drag end.
- `timeToPercent(timeStr)` maps `"08:00"` (0%) to `"23:00"` (100%).
- `percentToTime(percent)` converts mouse X % position to nearest `"HH:MM"` 30-minute interval.
- Overlap warnings and color-coded shift highlights remain active during handle dragging.
