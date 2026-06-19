import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../core/api_client.dart';

/// Firebase Cloud Messaging wiring. Only initialised when Firebase itself
/// initialised successfully (see main.dart) — the app works without it.
class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  Future<void> init() async {
    final messaging = FirebaseMessaging.instance;

    await messaging.requestPermission();

    final token = await messaging.getToken();
    debugPrint('FCM registration token: $token');

    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint(
        'Push received in foreground: ${message.notification?.title}',
      );
    });
  }

  /// Best-effort: registers the device's FCM token with the backend so the
  /// signed-in user can receive push. A no-op (silently swallowed) when Firebase
  /// is unconfigured — push stays optional.
  Future<void> registerToken(ApiClient api) async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      final platform =
          defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
      await api.post(
        '/communication/device-tokens',
        body: {'token': token, 'platform': platform},
      );
    } catch (e) {
      debugPrint('Device token registration skipped: $e');
    }
  }
}
