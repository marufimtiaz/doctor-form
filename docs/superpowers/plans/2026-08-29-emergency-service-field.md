# Emergency Service Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a boolean field `has_emergency_service` (`Emergency Service (12am afterwards)`) after `hospital_name` across backend models, database migrations, API schemas, and frontend UI.

**Architecture:** Backend SQLModel + FastAPI multipart endpoint + Alembic migration + Frontend Zod schema + Shadcn Form UI.

## Global Constraints

- Field position: directly after `hospital_name`
- Default value: `false`
- Must pass all backend pytest & frontend vitest tests

---

### Task 1: Update Backend Model, Schemas, API Endpoint & Alembic Migration

**Files:**
- Modify: `backend/app/models/survey.py`
- Modify: `backend/app/schemas/survey.py`
- Modify: `backend/app/api/surveys.py`
- Create: `backend/alembic/versions/0002_add_emergency_service.py`
- Modify: `backend/tests/test_surveys_api.py`, `backend/tests/test_survey_schemas.py`, etc.

- [ ] **Step 1: Update `ChamberSurvey` model in `backend/app/models/survey.py`**
- [ ] **Step 2: Update `SurveyCreate` & `SurveyRead` in `backend/app/schemas/survey.py`**
- [ ] **Step 3: Update `create_survey` API endpoint in `backend/app/api/surveys.py`**
- [ ] **Step 4: Create Alembic Migration `backend/alembic/versions/0002_add_emergency_service.py`**
- [ ] **Step 5: Run backend pytest suite**

---

### Task 2: Update Frontend Schema, Form Component & My Surveys List

**Files:**
- Modify: `frontend/src/schemas/survey.ts`
- Modify: `frontend/src/routes/AgentPage.tsx`
- Modify: `frontend/src/schemas/survey.test.ts`

- [ ] **Step 1: Add `has_emergency_service` to `surveySchema` and `emptySurveyValues` in `frontend/src/schemas/survey.ts`**
- [ ] **Step 2: Add Yes/No FormField in `frontend/src/routes/AgentPage.tsx` after `hospital_name` and update submit logic & survey card list**
- [ ] **Step 3: Run frontend vitest test suite & TypeScript check**
