# Tuition Class Tracker — Implementation Status

## Completed in this milestone

### Google Sheet — DEVELOPMENT copy
- Separate development workbook created from the master tracker.
- Production schema v1 verified.
- Existing fee rows received permanent Fee Record IDs.
- Existing paid totals were migrated into immutable `Payments` transactions.
- Existing attendance received Attendance IDs, Session IDs, Class IDs, versions and audit fields.
- `Classes`, `Enrollments`, `Class Sessions`, `Payments`, `Users`, `User Permissions`, `Access Requests`, `Reference Data`, and `Audit Log` are present.
- Existing test students were linked to migrated classes/enrollments/sessions.
- Fee Tracker paid/balance/status columns now derive from `Payments`.
- Controlled reference values seeded for attendance/student/user/class/session/enrollment/payment statuses.
- Settings include schema version `1.0.0`, `DEVELOPMENT`, and Google Sheets source-of-truth markers.

### Netlify staging project
- Site/project created: `tuition-class-tracker-dev`.
- Development Sheet ID configured as a server-side environment variable.
- Development auth mode configured.
- Sri Lanka timezone configured.
- Google service-account email/private key intentionally NOT fabricated or stored.
- Dedicated handover Admin configured: `classtrackertdg@gmail.com`.

### Frontend
- React + TypeScript + Vite source structure.
- Mobile-first responsive Admin shell.
- Desktop sidebar and mobile bottom navigation.
- Dashboard live API integration.
- Students live list/search/filter.
- Add Student modal with class selection and smart Relationship add-new flow.
- Today page and live today's-class API.
- Attendance UI with class/date selection, active class roster, Mark All Present and fixed statuses.
- Payments UI with student/month/date/amount and smart Payment Method add-new flow.
- Reports, History and Admin Portal navigation shells.
- Human-readable loading/error/success states.

### Backend / Netlify Functions
- Server-side Google service-account JWT implementation using Web Crypto.
- Google Sheets read and atomic batch-update helpers.
- Safe insert-row + exact-row write engine; raw `appendCells` removed from mutation paths to prevent physical-grid append/collision issues.
- Fail-closed authentication/config behavior.
- Dashboard endpoint.
- Students GET/POST with permanent ID, duplicate check, multi-class enrollment and Audit Log write.
- Classes GET endpoint.
- Class-students endpoint.
- Today endpoint.
- Reference Data GET/POST with duplicate normalization and controlled-list protection.
- Attendance batch POST with automatic session creation, enrollment checks and duplicate prevention.
- Attendance correction PATCH with mandatory reason and before/after audit record.
- Payments GET/POST with automatic monthly fee creation, historical fee lookup, partial payments, overpayment prevention and request-ID idempotency.
- Payment PATCH/DELETE for correction/void with mandatory reason and audit trail.
- Core backend TypeScript files validated with a local Netlify type stub after the safe-write patch.
- Frontend TS/TSX syntax-transpile checks passed.

## Required external setup before live integration test

A Google Cloud service account must be created with access to Google Sheets API. The DEVELOPMENT Google Sheet must be shared with the service-account email as Editor. Then set these two Netlify environment variables:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (mark as secret)

No production site should use `APP_AUTH_MODE=development`. Google Login will replace development auth before client handover.

## Next implementation modules

1. Edit / archive student UI and API.
2. Class creation/edit/archive and enrollment management UI.
3. Attendance history + correction UI.
4. Payment history + correction/void UI.
5. Monthly Control generation and missing fee records UI.
6. Staff profiles, access requests and permission editor.
7. System Health centre.
8. Audit/History Centre daily-weekly-monthly-yearly views.
9. Reports + PDF/CSV/XLSX/image/share exports.
10. Help Centre and first-login walkthrough.
11. Google Identity Services login and approval flow.
12. End-to-end staging tests, security audit, production migration and production deploy.
