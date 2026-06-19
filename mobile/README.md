# SRE EDU OS — Mobile

Flutter app for the SRE EDU OS school ERP, with Firebase Cloud Messaging for
push notifications.

## Parent/Student parity (Phase 1)

The app is role-aware. Students and parents get a portal experience built
entirely on the existing owner/tenant-scoped backend APIs (Bearer auth via
`/auth/login` with refresh + graceful session expiry):

- **Dashboard** with a parent **child selector** (attendance rate, outstanding
  fees, pending invoices, quick links).
- **Attendance** — monthly summary + recent records.
- **Fees** — pending/paid invoices, **Pay Online** via the Online Fee Gateway
  (hosted checkout), a payment-result screen, and fee-receipt download.
- **Homework** — list, detail, attachment download, and text submission.
- **Notices** — announcements + a message **inbox** with read state.
- **Documents / Report cards / ID card** — authenticated PDF download + view.
- **Profile** for the selected student/child.

Staff keep the existing dashboard/notices/profile. Staff mobile parity is a
later phase.

## Getting started

The repo tracks only the Dart source. Generate the platform folders once:

```bash
cd mobile
flutter create . --platforms android,ios --project-name sreedo_mobile
flutter pub get
```

### Push notifications (optional)

FCM is disabled until Firebase is configured. To enable it:

```bash
dart pub global activate flutterfire_cli
flutterfire configure
```

The app starts and runs fine without Firebase config — push setup is
skipped with a log message.

## Pointing at the API

The API base URL defaults to `http://10.0.2.2:4000/api/v1` (Android
emulator loopback). Override it at build/run time:

```bash
flutter run --dart-define=API_URL=https://your-domain.com/api/v1
```
