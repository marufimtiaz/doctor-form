# Nameplate Image Change & Remove Design

## Context
When field agents take or upload a nameplate photo in the Doctor form section, there was previously no explicit option to remove the photo, and re-capturing or picking an image when one was already loaded could fail to trigger the file change event if the file input value wasn't cleared prior to picker invocation.

## Goals
1. Provide an explicit **"Remove photo"** button when a nameplate image is present.
2. Ensure clicking **"Open camera"** or **"Upload image"** when a photo is already present reliably opens the picker and replaces the existing image and OCR data.
3. Keep the doctor form state and OCR extraction pipeline consistent when images are replaced or removed.

## Detailed Architecture & Changes

### 1. `frontend/src/components/NameplateInput.tsx`
- **File Input Reset**: In `openPicker(source)`, reset `inputRef.current.value = ""` before calling `.click()`. This guarantees that selecting a file (even one with the same name or re-captured) always fires `<input type="file">`'s `onChange` event.
- **Remove Button**: Render a **"Remove photo"** button (using `Trash2` icon from `lucide-react`) whenever `file` is non-null.
- **Button Actions**:
  - Clicking "Remove photo" calls `onChange(null)`, clearing the preview and file selection.
  - Clicking "Open camera" or "Upload image" opens the camera or file library picker respectively.

### 2. `frontend/src/routes/DoctorPage.tsx`
- **Clearing Photo Handling**: When `onChange(null)` is called (via "Remove photo"):
  - Sets `nameplate` state to `null`.
  - Clears `nameplateError`.
  - Triggers `readNameplate(null)` which sets `ocrState` to `"idle"` and resets `doctor_name`, `doctor_degrees`, and `doctor_specializations` fields in the form.
- **Replacing Photo Handling**: When `onChange(newFile)` is called:
  - Immediately updates `nameplate` state to `newFile`.
  - Clears `nameplateError`.
  - Triggers `readNameplate(newFile)` which increments `previewToken` and initiates OCR preview reading for `newFile`.

## Testing Plan
1. **Unit & Component Testing**:
   - Verify `NameplateInput` renders camera, upload, and remove buttons correctly depending on `file` prop state.
   - Verify clicking "Remove photo" invokes `onChange(null)`.
   - Verify clicking "Open camera" or "Upload image" resets input value and opens picker.
2. **Form State Integration**:
   - Verify removing an image resets form OCR fields to empty strings and OCR state to idle.
   - Verify replacing an image triggers new OCR read call.
