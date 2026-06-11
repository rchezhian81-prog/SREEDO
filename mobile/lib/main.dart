import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'providers/announcements_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/dashboard_provider.dart';
import 'services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase (FCM) stays optional until `flutterfire configure` has been
  // run; without platform config the app simply skips push notifications.
  try {
    await Firebase.initializeApp();
    await NotificationService.instance.init();
  } catch (e) {
    debugPrint('Firebase not configured — push notifications disabled: $e');
  }

  final apiClient = ApiClient();
  final authProvider = AuthProvider(apiClient);
  await authProvider.restoreSession();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authProvider),
        ChangeNotifierProvider(create: (_) => DashboardProvider(apiClient)),
        ChangeNotifierProvider(
          create: (_) => AnnouncementsProvider(apiClient),
        ),
      ],
      child: SreedoApp(authProvider: authProvider),
    ),
  );
}
