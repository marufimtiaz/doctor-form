import { useState } from "react";

import { Input } from "@/components/ui/input";
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

  const message = sizeError ?? error ?? null;

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <Label className="text-sm font-medium">Doctor nameplate photo</Label>
      <p className="text-xs text-muted-foreground">
        Required. The doctor&apos;s name, degrees and specializations are read
        from this image later.
      </p>
      <Input
        type="file"
        accept="image/*"
        aria-label="Nameplate photo"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setSizeError("Image is larger than 10MB.");
            setPreview(null);
            onChange(null);
            return;
          }
          setSizeError(null);
          setPreview(picked ? URL.createObjectURL(picked) : null);
          onChange(picked);
        }}
      />
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
