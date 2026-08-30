# Nameplate Image Change & Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Remove photo" button and ensure re-capturing or re-uploading an image in `NameplateInput` reliably resets input state and triggers OCR updates.

**Architecture:**
In `NameplateInput.tsx`, add a "Remove photo" button when `file` is present and ensure `openPicker()` clears `inputRef.current.value = ""` so re-selection of files always triggers `onChange`. In `DoctorPage.tsx`, ensure `onChange(null)` clears nameplate file state, error state, and resets OCR state/fields.

**Tech Stack:** React 19, TypeScript, Lucide React (`Trash2`, `Camera`, `ImageUp`), Vitest.

## Global Constraints
- React 19 & TypeScript 5.9.
- Preserve existing form validation & API contracts.
- Run `npm run lint` and `npm test` to verify zero build or test regressions.

---

### Task 1: Update `NameplateInput.tsx` with Remove Button and Input Reset

**Files:**
- Modify: `frontend/src/components/NameplateInput.tsx`

**Interfaces:**
- Consumes: `file: File | null`, `onChange: (file: File | null) => void`, `error?: string | null`
- Produces: Enhanced `NameplateInput` component that provides a "Remove photo" button when a file is selected and resets the file input value on picker open.

- [ ] **Step 1: Inspect `NameplateInput.tsx` current implementation**

Ensure imports include `Trash2` from `"lucide-react"`.

- [ ] **Step 2: Implement file input reset and Remove photo button**

In `frontend/src/components/NameplateInput.tsx`:
1. Import `Trash2` from `"lucide-react"`.
2. In `openPicker`:
```tsx
  const openPicker = (source: "camera" | "library") => {
    const el = inputRef.current;
    if (!el) return;
    el.value = "";
    if (source === "camera") el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  };
```
3. In the button group, when `file` is present, render:
```tsx
  {file && (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => {
        if (inputRef.current) inputRef.current.value = "";
        setSizeError(null);
        onChange(null);
      }}
    >
      <Trash2 className="size-4" aria-hidden /> Remove photo
    </Button>
  )}
```

- [ ] **Step 3: Run linter and build check**

Run: `npm run lint && npm run build` in `frontend/`
Expected: 0 errors.

- [ ] **Step 4: Commit changes**

```bash
git add frontend/src/components/NameplateInput.tsx
git commit -m "feat: add remove photo button and reset file input on picker open"
```

---

### Task 2: Verify and Test Integration in `DoctorPage.tsx`

**Files:**
- Modify: `frontend/src/routes/DoctorPage.tsx`

**Interfaces:**
- Consumes: `NameplateInput` component `onChange` callback
- Produces: Full doctor form workflow handling file selection, file replacement, and file removal with OCR state reset.

- [ ] **Step 1: Verify `DoctorPage.tsx` handles `onChange(null)` and file replacement**

Check `onChange` callback in `DoctorPage.tsx`:
```tsx
<NameplateInput
  key={resetKey}
  file={nameplate}
  onChange={(f) => {
    setNameplate(f);
    if (f) setNameplateError(null);
    void readNameplate(f);
  }}
  error={nameplateError}
/>
```
Verify that when `f` is `null`:
- `setNameplate(null)` sets state.
- `readNameplate(null)` is called, setting `setOcrState("idle")` and clearing form fields `doctor_name`, `doctor_degrees`, `doctor_specializations`.

- [ ] **Step 2: Run frontend unit tests and type checks**

Run: `npm test && npm run build` in `frontend/`
Expected: PASS (all tests pass, build succeeds).

- [ ] **Step 3: Commit and verify complete feature**

```bash
git add frontend/src/routes/DoctorPage.tsx
git commit -m "test: verify nameplate image removal and replacement integration"
```
