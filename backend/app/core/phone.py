import phonenumbers
from phonenumbers import NumberParseException

# Numbers are typed by agents in Bangladesh, so a bare "017…" is a BD number.
DEFAULT_REGION = "BD"


def normalize_phone(raw: str, region: str = DEFAULT_REGION) -> str:
    """Return `raw` as E.164, e.g. "+8801712345678".

    Raises ValueError when the input cannot be parsed or is not a real number.
    Every phone that reaches the database goes through here, so a uniqueness
    constraint on the column means what it appears to mean.
    """
    try:
        parsed = phonenumbers.parse(raw, region)
    except NumberParseException as exc:
        raise ValueError(f"could not parse phone number: {raw!r}") from exc
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError(f"not a valid phone number: {raw!r}")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
