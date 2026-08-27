# Visual overhaul: shadcn/ui, Tailwind, and typed forms

**Date:** 2026-08-27
**Status:** approved design, pending implementation plan

## Problem

The frontend works and looks like a scaffold. 182 lines of hand-written CSS
carry the whole interface, forms are assembled from raw `<input>` elements with
one `useState` per field, and validation rules are re-implemented inline in each
component. Nothing is wrong with it; nothing about it says this is a tool
somebody built on purpose.

This replaces the styling layer with Tailwind and shadcn/ui, moves form state
onto react-hook-form with zod schemas, and gives the frontend its first test
runner.

No features change. No routes change. The backend is not touched.

## Decisions

### A considered identity, not the stock theme

shadcn ships a neutral zinc theme that is instantly recognisable as shadcn. The
tokens below are chosen for this domain instead: field agents recording doctors'
chambers, often on a phone, often in a hospital basement.

| Token | Value | Reasoning |
|---|---|---|
| Primary | teal `#0f766e` | Clinical without the sterile blue of every dashboard; holds up on a dim phone screen |
| Neutrals | slate | Cool enough to pair with teal, warmer than zinc's flat grey |
| Destructive | `#b91c1c` | Deletion is admin-only and should look irreversible |
| Radius | `0.5rem` | Softer than stock, short of consumer-app rounding |

### No webfont

Character comes from colour, density, and hierarchy, not from typography. The
system font stack renders instantly; a 40KB webfont blocks first paint, and the
people who pay that cost are exactly the agents on a bad connection in a
basement. The type *scale* tightens; the type *files* stay at zero.

### Tailwind v4, CSS-first

`@theme` in CSS rather than a `tailwind.config.js`, with the official
`@tailwindcss/vite` plugin. Fewer moving parts than v3 and the version shadcn
now targets.

### Preflight is deferred to the last commit

`@import "tailwindcss"` includes a reset that zeroes the base element styles
`index.css` depends on. Enabling it up front would degrade every screen not yet
migrated.

So Tailwind is imported by layer with the reset omitted:

```css
@layer theme, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

Old CSS keeps working, screens migrate one at a time, and the final commit
swaps in the full `@import "tailwindcss"` and deletes `index.css`.

**Omitting preflight entirely would break the shadcn components themselves.**
Tailwind's `border` utility sets `border-width` but relies on preflight to set
`border-style: solid` globally; without it, every Card, Input and Separator
renders with no visible border at all. So the migration carries a minimal
compatibility layer — the parts of preflight shadcn depends on, and none of the
typographic reset that would break the old stylesheet:

```css
@layer base {
  *, ::before, ::after {
    box-sizing: border-box;
    border-width: 0;
    border-style: solid;
    border-color: var(--color-border, currentColor);
  }
}
```

This block is deleted in the final commit along with `index.css`, when real
preflight takes over. With it, every intermediate commit is a working
application that looks right.

### react-hook-form and zod

shadcn's `Form` primitive is built on react-hook-form, and using it means
schema validation, per-field error placement, and dirty state come free instead
of being hand-rolled per component.

The larger blast radius is accepted deliberately: every validator in the
frontend is re-implemented as part of this. That is why the next decision
exists.

### The frontend gets a test runner

Re-implementing validation with `tsc --noEmit` as the only gate would mean
nothing checks that the rules still mean what they meant. TypeScript proves the
code compiles; it cannot prove that "provide coordinates or city and district"
still rejects the empty case.

vitest, testing the zod schemas only. They are pure functions — no DOM, no
component rendering, no jsdom. Component-render tests are explicitly out of
scope: the markup is what this project churns, so tests written against it now
would be rewritten twice.

## Client validation is not a security boundary

The zod schemas restate rules the backend already enforces in
`backend/app/schemas/`. They exist so an agent sees an error beside the field
instead of after a round trip. The server rejects everything independently, and
nothing here relaxes that.

Because the same rule now lives in two places, the vitest suite covers the same
cases as `backend/tests/test_survey_schemas.py`. If the two drift, a test fails
rather than an agent discovering it on site.

## Foundation

**New configuration**

| File | Purpose |
|---|---|
| `components.json` | shadcn CLI config; components land in `src/components/ui` |
| `src/index.css` | `@theme` tokens, layer imports, `.dark` block |
| `src/lib/utils.ts` | `cn()` — the `clsx` + `tailwind-merge` helper every shadcn component imports |
| `vite.config.ts` | `@tailwindcss/vite` plugin, `@/*` alias |
| `tsconfig.json` | `baseUrl` and `paths` for `@/*` |
| `vitest.config.ts` | node environment, no jsdom |
| `package.json` | adds `"test": "vitest run"` and `"test:watch": "vitest"` |

**Dependencies added:** `tailwindcss`, `@tailwindcss/vite`, `clsx`,
`tailwind-merge`, `class-variance-authority`, `lucide-react`,
`react-hook-form`, `zod`, `@hookform/resolvers`, `sonner`, and the Radix
primitives the chosen components pull in. Dev: `vitest`.

**Dark mode** carries the existing `prefers-color-scheme` values onto shadcn's
`.dark` class convention. Same behaviour as today; no manual toggle, because
nobody asked for one.

## Schemas

Four modules in `src/schemas/`, each mirroring its backend counterpart:

| Module | Rules |
|---|---|
| `survey.ts` | hospital required; location either-pair (coords or city+district, each all-or-nothing, at least one); slots min 1, `end > start`, day 0–6; phones min 1; `daily_patients > 0`; `avg_duration_min > 0`; `consultation_fee_bdt >= 0` |
| `auth.ts` | phone non-empty; password non-empty (never a length rule at login — rejecting a short password would tell an attacker their guess was the wrong shape) |
| `password.ts` | 8–128 characters; `new === confirm` |
| `user.ts` | name, phone, company, role, password 8–128 |

## Components

Primitives generated by the shadcn CLI into `src/components/ui`: `button`,
`input`, `label`, `card`, `form`, `select`, `table`, `badge`, `separator`,
`alert`, `dialog`, `alert-dialog`, `dropdown-menu`, `skeleton`, `sonner`.

Application components keep their current boundaries and props; only their
internals change:

| File | Change |
|---|---|
| `LoginPage.tsx` | Card-centred form; `useForm` + `authSchema` |
| `App.tsx` | Header becomes a proper app bar: role `Badge`, `DropdownMenu` for account actions |
| `AgentPage.tsx` | `Form` wrapping the whole survey; stat strip becomes `Card`s with `Skeleton` while loading |
| `AdminPage.tsx` | Stat `Card`s; surveys as `Table` at `md`+ and cards below; `Dialog` for password reset; `AlertDialog` for delete |
| `SlotEditor.tsx` | `useFieldArray`; `Select` for day, `Input type=time` for the bounds |
| `PhoneEditor.tsx` | `useFieldArray` |
| `LocationInput.tsx` | Same geolocation behaviour; the either-pair rule moves into the schema, and errors render in `FormMessage` |
| `NameplateInput.tsx` | Styled file input with preview; keeps the 10MB pre-check |
| `PasswordForm.tsx` | `Form` + `passwordSchema`; keeps the `requireCurrent` prop |

### Three behavioural changes

These are fixes carried along with the overhaul, not new features:

- **`confirm()` becomes `AlertDialog`.** `AdminPage` deletes through a native
  `confirm()` today, which cannot be styled and reads as a browser popup rather
  than part of the application.
- **Request failures become toasts; field errors move beside their field.**
  Today a slot-ordering error and a network failure both land in the same box
  at the top of the page.
- **Stats render a `Skeleton` while loading.** `AgentPage` currently shows
  `0 today · 0 total` before the fetch returns, presenting a placeholder as a
  fact.

## Verification

Every commit must pass `npm run build` (`tsc --noEmit` then `vite build`) and
`npm test` (vitest).

The backend's 116 tests must stay green throughout. Nothing in this project
touches them, so a failure there means something leaked across the boundary.

Manual pass at each screen commit — the same flows the authentication work
established, because these are what must not break:

1. Sign in as the seeded admin.
2. File a survey with city and district only, no coordinates.
3. Add a slot, remove a slot, submit one with `end` before `start`.
4. Submit without a nameplate.
5. Change your own password; confirm the session survives.
6. As admin, reset an agent's password; confirm that agent is signed out.
7. Delete a survey; confirm it leaves the list and the totals drop.

Each screen is also checked at a 375px viewport, since the agent form is used
on a phone.

## Explicitly out of scope

- Any change to features, routes, or the backend.
- Component-render tests (`@testing-library/react`, jsdom).
- A manual dark-mode toggle.
- Splitting `AgentPage` and `AdminPage` into smaller section components. They
  are 230 and 269 lines; if they grow past roughly 400 during the rewrite, that
  becomes worth revisiting as its own change.
- Replacing `eslint` — it is still a scaffold stub, and remains a known gap.
