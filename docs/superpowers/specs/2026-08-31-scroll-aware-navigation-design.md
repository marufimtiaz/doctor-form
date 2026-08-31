# Scroll-Aware Auto-Hide Navigation Design

## Overview
Replace the unpredictable document-wide background tap and focus-in/out panel toggling (`useAutoDistractFree`) with a smooth, native scroll-aware navigation visibility system (`useScrollDistractFree`).

## User Experience Goal
Provide a predictable, fluid mobile experience where top header and bottom navigation bars hide when the user scrolls down to focus on content or forms, and reveal immediately when the user scrolls up or reaches the top of the page.

## Key Changes

### 1. New Hook: `useScrollDistractFree`
Location: `frontend/src/hooks/useScrollDistractFree.ts`

- **State:** Tracks `hidden` boolean.
- **Scroll Logic:**
  - Listens to window scroll events with a passive event listener.
  - Keeps panels visible (`hidden = false`) when `window.scrollY < 20px` (top threshold).
  - When scrolling down by more than `15px` threshold, sets `hidden = true`.
  - When scrolling up by more than `10px` threshold, sets `hidden = false`.
- **Eliminates:**
  - Background tap listener (`pointerdown` event listener on `document`).
  - Input focus/blur listener (`focusin`/`focusout` event listeners on `document`).

### 2. Deprecate / Remove Old Hook
Location: `frontend/src/hooks/useAutoDistractFree.ts`
- Remove `useAutoDistractFree.ts` and replace imports in `App.tsx` and `DoctorPage.tsx`.

### 3. Application Component Updates
Location: `frontend/src/App.tsx` & `frontend/src/routes/DoctorPage.tsx`
- Import `useScrollDistractFree` instead of `useAutoDistractFree`.
- Pass `hidden` state to `Header` and `BottomNav` components.
- Retain smooth CSS transition classes (`transition-transform duration-300 ease-in-out`).

## Non-Goals
- No changes to page routes, forms, backend APIs, or i18n configurations.

## Testing & Verification
- Unit test for `useScrollDistractFree` verifying scroll delta triggers and top boundary conditions.
- Frontend build and Vitest suite verification (`npm run test`, `npm run build`).
