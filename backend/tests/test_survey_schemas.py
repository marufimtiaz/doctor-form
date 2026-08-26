import pytest
from pydantic import ValidationError

from app.schemas.survey import SurveyCreate

BASE = {
    "hospital_name": "Square Hospital",
    "daily_patients": 30,
    "avg_duration_min": 10,
    "consultation_fee_bdt": 1200,
    "slots": [{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}],
    "phones": ["01712345678"],
}


def test_coordinates_alone_are_enough():
    survey = SurveyCreate(**BASE, latitude=23.75, longitude=90.39)
    assert survey.city is None


def test_city_and_district_alone_are_enough():
    survey = SurveyCreate(**BASE, city="Dhaka", district="Dhanmondi")
    assert survey.latitude is None


def test_both_pairs_together_are_fine():
    survey = SurveyCreate(**BASE, latitude=23.75, longitude=90.39, city="Dhaka", district="D")
    assert survey.latitude == 23.75


def test_no_location_at_all_is_rejected():
    with pytest.raises(ValidationError, match="coordinates or city and district"):
        SurveyCreate(**BASE)


def test_half_a_coordinate_pair_is_rejected():
    with pytest.raises(ValidationError, match="latitude and longitude"):
        SurveyCreate(**BASE, latitude=23.75)


def test_half_a_place_pair_is_rejected():
    with pytest.raises(ValidationError, match="city and district"):
        SurveyCreate(**BASE, city="Dhaka")


def test_whitespace_city_does_not_satisfy_the_location_rule():
    with pytest.raises(ValidationError):
        SurveyCreate(**BASE, city="   ", district="   ")


def test_out_of_range_latitude_is_rejected():
    with pytest.raises(ValidationError):
        SurveyCreate(**BASE, latitude=120.0, longitude=90.39)


def test_phones_are_normalized():
    survey = SurveyCreate(**BASE, city="Dhaka", district="D")
    assert survey.phones == ["+8801712345678"]


def test_at_least_one_phone_is_required():
    payload = {**BASE, "phones": []}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_at_least_one_slot_is_required():
    payload = {**BASE, "slots": []}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_slot_end_must_follow_start():
    payload = {**BASE, "slots": [{"day_of_week": 5, "start_time": "20:00", "end_time": "17:00"}]}
    with pytest.raises(ValidationError, match="end_time"):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_day_seven_is_rejected():
    payload = {**BASE, "slots": [{"day_of_week": 7, "start_time": "17:00", "end_time": "20:00"}]}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_zero_patients_is_rejected():
    payload = {**BASE, "daily_patients": 0}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_a_free_consultation_is_allowed():
    survey = SurveyCreate(**{**BASE, "consultation_fee_bdt": 0}, city="Dhaka", district="D")
    assert survey.consultation_fee_bdt == 0
