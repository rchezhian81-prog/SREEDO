import 'package:flutter/foundation.dart';

import '../core/api_client.dart';

class AppUser {
  AppUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        email: json['email'] as String,
        fullName: json['fullName'] as String,
        role: json['role'] as String,
      );

  final String id;
  final String email;
  final String fullName;
  final String role;
}

class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api) {
    // When a request is unauthorized and cannot be refreshed, drop the session
    // so GoRouter routes back to login (graceful expiry handling).
    _api.onUnauthorized = _handleExpired;
  }

  final ApiClient _api;

  AppUser? user;
  bool restoring = true;

  bool get isAuthenticated => user != null;

  String get role => user?.role ?? '';
  bool get isParent => role == 'parent';
  bool get isPortal => role == 'student' || role == 'parent';
  bool get isStaff =>
      role == 'admin' ||
      role == 'teacher' ||
      role == 'accountant' ||
      role == 'super_admin';

  void _handleExpired() {
    if (user != null) {
      user = null;
      notifyListeners();
    }
  }

  /// Restores a persisted session on app start by validating the stored
  /// tokens against /auth/me.
  Future<void> restoreSession() async {
    await _api.loadTokens();
    if (_api.hasSession) {
      try {
        final profile = await _api.get('/auth/me');
        user = AppUser.fromJson(profile as Map<String, dynamic>);
      } catch (_) {
        await _api.clearTokens();
      }
    }
    restoring = false;
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final data = await _api.post(
      '/auth/login',
      body: {'email': email, 'password': password},
    ) as Map<String, dynamic>;
    await _api.saveTokens(
      data['accessToken'] as String,
      data['refreshToken'] as String,
    );
    user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> logout() async {
    final refreshToken = _api.refreshToken;
    if (refreshToken != null) {
      try {
        await _api.post('/auth/logout', body: {'refreshToken': refreshToken});
      } catch (_) {
        // best effort — clear locally regardless
      }
    }
    await _api.clearTokens();
    user = null;
    notifyListeners();
  }
}
