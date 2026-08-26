from datetime import UTC, datetime

import pytest

from app.core.phone import normalize_phone
from app.core.timeutil import day_bounds_utc


def test_local_number_becomes_e164():
    assert normalize_phone("01712345678") == "+8801712345678"


def test_already_e164_is_unchanged():
    assert normalize_phone("+8801712345678") == "+8801712345678"


def test_spacing_and_punctuation_are_ignored():
    assert normalize_phone("017-1234 5678") == "+8801712345678"


def test_garbage_raises_value_error():
    with pytest.raises(ValueError):
        normalize_phone("not a phone")


def test_too_short_raises_value_error():
    with pytest.raises(ValueError):
        normalize_phone("12")


def test_dhaka_day_starts_six_hours_before_utc_midnight():
    # 2026-08-26 19:00Z is 2026-08-27 01:00 in Dhaka (UTC+6), so the day
    # containing it starts at 2026-08-26 18:00Z.
    at = datetime(2026, 8, 26, 19, 0, tzinfo=UTC)
    start, end = day_bounds_utc("Asia/Dhaka", at)
    assert start == datetime(2026, 8, 26, 18, 0, tzinfo=UTC)
    assert end == datetime(2026, 8, 27, 18, 0, tzinfo=UTC)


def test_moment_just_before_local_midnight_belongs_to_the_earlier_day():
    at = datetime(2026, 8, 26, 17, 59, tzinfo=UTC)  # 23:59 Dhaka on the 26th
    start, _ = day_bounds_utc("Asia/Dhaka", at)
    assert start == datetime(2026, 8, 25, 18, 0, tzinfo=UTC)
