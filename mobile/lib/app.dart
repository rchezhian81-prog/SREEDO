import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'providers/auth_provider.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';

class SreedoApp extends StatefulWidget {
  const SreedoApp({super.key, required this.authProvider});

  final AuthProvider authProvider;

  @override
  State<SreedoApp> createState() => _SreedoAppState();
}

class _SreedoAppState extends State<SreedoApp> {
  late final GoRouter _router = GoRouter(
    initialLocation: '/home',
    refreshListenable: widget.authProvider,
    redirect: (context, state) {
      final loggedIn = widget.authProvider.isAuthenticated;
      final loggingIn = state.matchedLocation == '/login';
      if (!loggedIn && !loggingIn) return '/login';
      if (loggedIn && loggingIn) return '/home';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/home',
        builder: (context, state) => const HomeShell(),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'SRE EDU OS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2748DB)),
        useMaterial3: true,
      ),
      routerConfig: _router,
    );
  }
}
