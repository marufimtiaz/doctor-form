from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo


def day_bounds_utc(tz_name: str, at: datetime | None = None) -> tuple[datetime, datetime]:
    """Half-open UTC range [start, end) covering the local day containing `at`.

    Counts are reported per local day. Comparing against a UTC day would roll
    the agents' day over at 06:00 local and make every daily figure wrong.
    """
    tz = ZoneInfo(tz_name)
    moment = at or datetime.now(UTC)
    local = moment.astimezone(tz)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)
