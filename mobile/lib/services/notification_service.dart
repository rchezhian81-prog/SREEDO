import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

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
}
