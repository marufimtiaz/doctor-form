import { useState } from "react";

const MAX_BYTES = 10 * 1024 * 1024;

export default function NameplateInput({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <fieldset>
      <legend>Doctor nameplate photo</legend>
      <p className="muted">
        Required. The doctor's name, degrees and specializations are read from
        this image later.
      </p>
      <input
        type="file"
        accept="image/*"
        aria-label="Nameplate photo"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setError("Image is larger than 10MB.");
            setPreview(null);
            onChange(null);
            return;
          }
          setError(null);
          setPreview(picked ? URL.createObjectURL(picked) : null);
          onChange(picked);
        }}
      />
      {error && <p className="error">{error}</p>}
      {preview && <img className="preview" src={preview} alt="Nameplate preview" />}
      {file && !error && <p className="muted">{file.name}</p>}
    </fieldset>
  );
}
