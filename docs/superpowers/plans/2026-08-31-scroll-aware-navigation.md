# Scroll-Aware Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the document-wide background tap and focus-in/out panel toggle with a smooth, native scroll-aware navigation visibility system (`useScrollDistractFree`).

**Architecture:** A React custom hook (`useScrollDistractFree`) listens to window scroll events. When scrolling down past a 15px delta threshold, it sets `hidden = true` to hide header and bottom navigation bars. When scrolling up by 10px or when scrolled near the top (`scrollY < 20px`), it sets `hidden = false`. The hook is used in `App.tsx` and `DoctorPage.tsx` to control navigation transitions.

**Tech Stack:** React 19, TypeScript, Vitest, `@testing-library/react`.

## Global Constraints
- Target directory: `frontend/`
- All tests must pass via `npm --prefix frontend run test -- --run`
- Production build must succeed via `npm --prefix frontend run build`

---

### Task 1: Create `useScrollDistractFree` hook with unit tests

**Files:**
- Create: `frontend/src/hooks/useScrollDistractFree.ts`
- Create: `frontend/src/hooks/useScrollDistractFree.test.ts`

**Interfaces:**
- Consumes: None (Window scroll event APIs)
- Produces: `export function useScrollDistractFree(): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/hooks/useScrollDistractFree.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrollDistractFree } from "./useScrollDistractFree";

describe("useScrollDistractFree", () => {
  it("defaults to false (visible) at top of page", () => {
    const { result } = renderHook(() => useScrollDistractFree());
    expect(result.current).toBe(false);
  });

  it("hides panels when scrolling down past threshold", () => {
    const { result } = renderHook(() => useScrollDistractFree());

    act(() => {
      window.scrollY = 100;
      window.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe(true);
  });

  it("reveals panels when scrolling up", () => {
    const { result } = renderHook(() => useScrollDistractFree());

    // Scroll down first
    act(() => {
      window.scrollY = 100;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(true);

    // Scroll up
    act(() => {
      window.scrollY = 50;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(false);
  });

  it("always reveals panels near top of page (scrollY < 20)", () => {
    const { result } = renderHook(() => useScrollDistractFree());

    // Scroll down
    act(() => {
      window.scrollY = 100;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(true);

    // Return to top
    act(() => {
      window.scrollY = 10;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- --run src/hooks/useScrollDistractFree.test.ts`
Expected: FAIL with "Cannot find module './useScrollDistractFree'"

- [ ] **Step 3: Implement `useScrollDistractFree`**

```typescript
// frontend/src/hooks/useScrollDistractFree.ts
import { useEffect, useRef, useState } from "react";

export function useScrollDistractFree() {
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Always show panels near the top
      if (currentScrollY < 20) {
        setHidden(false);
        lastScrollY.current = currentScrollY;
        return;
      }

      const delta = currentScrollY - lastScrollY.current;

      // Scroll down threshold
      if (delta > 15) {
        setHidden(true);
        lastScrollY.current = currentScrollY;
      }
      // Scroll up threshold
      else if (delta < -10) {
        setHidden(false);
        lastScrollY.current = currentScrollY;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return hidden;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test -- --run src/hooks/useScrollDistractFree.test.ts`
Expected: PASS (4 tests passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useScrollDistractFree.ts frontend/src/hooks/useScrollDistractFree.test.ts
git commit -m "feat: add useScrollDistractFree hook for scroll-driven panel visibility"
```

---

### Task 2: Update App and DoctorPage components and clean up old hook

**Files:**
- Modify: `frontend/src/App.tsx:12,115`
- Modify: `frontend/src/routes/DoctorPage.tsx:26,46`
- Delete: `frontend/src/hooks/useAutoDistractFree.ts`

**Interfaces:**
- Consumes: `useScrollDistractFree` from `frontend/src/hooks/useScrollDistractFree.ts`
- Produces: Updated application navigation behavior

- [ ] **Step 1: Update `frontend/src/App.tsx`**

Replace `useAutoDistractFree` import and invocation with `useScrollDistractFree`:

```typescript
// Replace line 12:
import { useScrollDistractFree } from "@/hooks/useScrollDistractFree";

// Replace line 115 in App():
const hidden = useScrollDistractFree();
```

- [ ] **Step 2: Update `frontend/src/routes/DoctorPage.tsx`**

Replace `useAutoDistractFree` import and invocation with `useScrollDistractFree`:

```typescript
// Replace line 26:
import { useScrollDistractFree } from "@/hooks/useScrollDistractFree";

// Replace line 46 in DoctorPage():
const navHidden = useScrollDistractFree();
```

- [ ] **Step 3: Remove `frontend/src/hooks/useAutoDistractFree.ts`**

Delete file `frontend/src/hooks/useAutoDistractFree.ts`.

- [ ] **Step 4: Verify test suite and build**

Run: `npm --prefix frontend run test -- --run && npm --prefix frontend run build`
Expected: PASS (All Vitest tests pass and Vite build produces production assets cleanly)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/routes/DoctorPage.tsx
git rm frontend/src/hooks/useAutoDistractFree.ts
git commit -m "refactor: replace auto distract free hook with scroll-aware navigation"
```
