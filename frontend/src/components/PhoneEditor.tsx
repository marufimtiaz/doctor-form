export default function PhoneEditor({
  phones,
  onChange,
}: {
  phones: string[];
  onChange: (phones: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>Chamber phone numbers</legend>
      {phones.map((phone, i) => (
        <div className="row" key={i}>
          <input
            required
            inputMode="tel"
            aria-label={`Phone ${i + 1}`}
            placeholder="01712345678"
            value={phone}
            onChange={(e) =>
              onChange(phones.map((p, idx) => (idx === i ? e.target.value : p)))
            }
          />
          {phones.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() => onChange(phones.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...phones, ""])}>
        Add number
      </button>
    </fieldset>
  );
}
