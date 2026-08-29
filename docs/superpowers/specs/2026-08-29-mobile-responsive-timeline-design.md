# Mobile Responsive Timeline Design Specification

## Overview
Improve the visual appearance, responsiveness, and touch interaction of the availability timeline bar and schedule editor on mobile screens (< 640px).

## Requirements
1. **Responsive Time Labels**:
   - Mobile (`< sm`): Display 4 milestone labels (`8 AM`, `1 PM`, `6 PM`, `11 PM`) to prevent label text overlapping.
   - Desktop (`sm:`): Display 8 hour labels (`8 AM`, `10 AM`, `12 PM`, `2 PM`, `4 PM`, `6 PM`, `8 PM`, `10 PM`).
2. **Full-Width Mobile Timeline & Button Placement**:
   - On mobile, position `+ Handle Pair` button in a dedicated flex header row so the timeline bar receives 100% full width.
3. **Touch-Friendly Drag Knobs (`touch-none`)**:
   - Add `touch-none` (`touch-action: none`) to handles and track to prevent finger drag from triggering vertical window scrolling.
   - Increase knob touch target area on touch devices (`w-5 h-7` with touch padding).
4. **Responsive Shift Row Cards**:
   - Ensure start/end time select dropdowns and duration badges wrap gracefully without horizontal scrollbars on mobile phones (320px–430px).

## Testing & Verification
- Test TypeScript (`npx tsc --noEmit`).
- Test Vitest unit tests (`npm test`).
- Test Vite build (`npm run build`).
