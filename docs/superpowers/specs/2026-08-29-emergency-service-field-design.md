# Emergency Service Field Design Specification

## Overview
Add a boolean field `has_emergency_service` directly after `hospital_name` in the survey form, backend model, API schemas, database, and survey list display:
1. **Label**: `Emergency Service (12am afterwards)`
2. **Options**: `Yes` / `No` (boolean, default: `No`)
3. **Database**: `has_emergency_service` column on `chamber_surveys` table (Boolean, NOT NULL, default=False).

## Changes Required

### Backend
1. **`backend/app/models/survey.py`**:
   - Add `has_emergency_service: bool = Field(default=False)` to `ChamberSurvey`.
2. **Alembic Migration (`backend/alembic/versions/0002_add_emergency_service.py`)**:
   - `op.add_column("chamber_surveys", sa.Column("has_emergency_service", sa.Boolean(), nullable=False, server_default="0"))`
3. **`backend/app/schemas/survey.py`**:
   - `SurveyCreate`: `has_emergency_service: bool = Field(default=False)`
   - `SurveyRead`: `has_emergency_service: bool = False`
4. **`backend/app/api/surveys.py`**:
   - `create_survey`: `has_emergency_service: Annotated[bool, Form()] = False`
   - Map form field into `SurveyCreate` and `ChamberSurvey`.

### Frontend
1. **`frontend/src/schemas/survey.ts`**:
   - Add `has_emergency_service: z.boolean().default(false)` to `surveySchema`.
   - Add `has_emergency_service: false` to `emptySurveyValues()`.
2. **`frontend/src/routes/AgentPage.tsx`**:
   - Render `FormField` for `has_emergency_service` right after `hospital_name`.
   - Append `has_emergency_service` to `FormData` on submission (`"true"` / `"false"`).
   - Display `Emergency Service: Yes/No` badge in survey card list.
