# SRE EDU OS — Mobile

Flutter app for staff and parents: dashboard, notice board and profile,
with Firebase Cloud Messaging for push notifications.

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
