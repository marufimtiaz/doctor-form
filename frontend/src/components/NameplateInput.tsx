import { Camera, ImageUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_BYTES = 10 * 1024 * 1024;

/** Stays outside react-hook-form: a File is not something zod can usefully
 *  validate, and the submit handler checks it directly. */
export default function NameplateInput({
  file,
  onChange,
  error,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | null;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      setSizeError(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const message = sizeError ?? error ?? null;

  /** `capture` is set per click rather than fixed on the element: with it the
   *  OS opens the camera straight to the rear lens, without it the normal
   *  picker. Desktop browsers ignore it, so "Open camera" degrades to the
   *  picker there, which is fine - the agents are on phones.
   *
   *  One input, not two: the reset above clears inputRef.current.value, and a
   *  second ref left uncleared would silently stop the same filename being
   *  re-picked for the next doctor. */
  const openPicker = (source: "camera" | "library") => {
    const el = inputRef.current;
    if (!el) return;
    el.value = "";
    if (source === "camera") el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  };

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <Label className="text-sm font-medium">Doctor nameplate photo</Label>
      <p className="text-xs text-muted-foreground">
        Required. The doctor&apos;s name, degrees and specializations are read
        from this image later.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Nameplate photo"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setSizeError("Image is larger than 10MB.");
            onChange(null);
            return;
          }
          setSizeError(null);
          onChange(picked);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openPicker("camera")}
        >
          <Camera className="size-4" aria-hidden /> Open camera
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openPicker("library")}
        >
          <ImageUp className="size-4" aria-hidden /> Upload image
        </Button>
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
      </div>
      {message && <p className="text-sm text-destructive">{message}</p>}
      {preview && (
        <img
          src={preview}
          alt="Nameplate preview"
          className="max-h-56 rounded-md border object-contain"
        />
      )}
      {file && !message && (
        <p className="text-xs text-muted-foreground">{file.name}</p>
      )}
    </fieldset>
  );
}
