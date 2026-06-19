import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'providers/announcements_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/dashboard_provider.dart';
import 'providers/portal_provider.dart';
import 'services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase (FCM) stays optional until `flutterfire configure` has been
  // run; without platform config the app simply skips push notifications.
  var firebaseReady = false;
  try {
    await Firebase.initializeApp();
    await NotificationService.instance.init();
    firebaseReady = true;
  } catch (e) {
    debugPrint('Firebase not configured — push notifications disabled: $e');
  }

  final apiClient = ApiClient();
  final authProvider = AuthProvider(apiClient);
  await authProvider.restoreSession();

  // Best-effort: register this device for push once we have a session.
  if (firebaseReady && authProvider.isAuthenticated) {
    await NotificationService.instance.registerToken(apiClient);
  }

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        ChangeNotifierProvider.value(value: authProvider),
        ChangeNotifierProvider(create: (_) => DashboardProvider(apiClient)),
        ChangeNotifierProvider(
          create: (_) => AnnouncementsProvider(apiClient),
        ),
        ChangeNotifierProvider(create: (_) => PortalProvider(apiClient)),
      ],
      child: SreedoApp(authProvider: authProvider),
    ),
  );
}
