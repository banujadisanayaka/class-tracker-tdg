# Tuition Class Tracker — Development

Production-oriented staging build for the tuition class management portal.

## Architecture

- React + TypeScript + Vite frontend
- Netlify Functions backend
- Google Sheets is the authoritative business-data store
- No client-side Google credentials
- No offline-success fallback for writes
- Development auth is admin-only and must never be enabled in production

## Development Sheet

`1vyJkp1LLFTQRdEOk8I5BIJq0V6Sjiirn2r0CV1osnMc`

## Required Netlify environment variables

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (secret)
- `APP_AUTH_MODE=development` for staging only
- `DEV_ADMIN_EMAIL=classtrackertdg@gmail.com`
- `APP_TIME_ZONE=Asia/Colombo`

The Google Sheet must be shared with the service-account email as Editor.

## Current milestone

Implemented:
- responsive admin application shell
- Dashboard and Students live read routes once credentials are present
- Add Student with permanent IDs, duplicate detection, class enrollment and Audit Log
- Today classes and class roster APIs
- batch attendance save with session creation, duplicate prevention and correction audit
- payment transactions with partial payments, overpayment protection, corrections and voiding
- smart reusable dropdown GET/POST with normalization
- Netlify Sheets REST client using server-side service account JWT
- exact-row + insert-row Sheets write engine (no raw `appendCells`)
- fail-closed authentication/config behavior
- development workbook schema migration
- dedicated staging Admin: `classtrackertdg@gmail.com`

Next modules:
- edit/archive student
- class/session/enrollment management UI
- attendance/payment history screens
- Monthly Control and fee changes
- staff/access requests/permissions
- system health/history centre
- report exports/image/share
- Google Identity Services production auth
