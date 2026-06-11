import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Thin JSON HTTP client with JWT bearer auth, token persistence via
/// SharedPreferences and automatic refresh-and-retry on 401s.
class ApiClient {
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    // Android emulator loopback to a locally running backend.
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );

  static const String _accessKey = 'sreedo_access_token';
  static const String _refreshKey = 'sreedo_refresh_token';

  String? _accessToken;
  String? _refreshToken;

  bool get hasSession => _refreshToken != null;
  String? get refreshToken => _refreshToken;

  Future<void> loadTokens() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString(_accessKey);
    _refreshToken = prefs.getString(_refreshKey);
  }

  Future<void> saveTokens(String accessToken, String refreshToken) async {
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessKey, accessToken);
    await prefs.setString(_refreshKey, refreshToken);
  }

  Future<void> clearTokens() async {
    _accessToken = null;
    _refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessKey);
    await prefs.remove(_refreshKey);
  }

  Future<dynamic> get(String path) => _request('GET', path);

  Future<dynamic> post(String path, {Object? body}) =>
      _request('POST', path, body: body);

  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
    bool allowRetry = true,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };

    final http.Response response;
    if (method == 'GET') {
      response = await http.get(uri, headers: headers);
    } else {
      response = await http.post(
        uri,
        headers: headers,
        body: body == null ? null : jsonEncode(body),
      );
    }

    if (response.statusCode == 401 &&
        allowRetry &&
        _refreshToken != null &&
        path != '/auth/login') {
      if (await _refreshSession()) {
        return _request(method, path, body: body, allowRetry: false);
      }
    }

    if (response.statusCode >= 400) {
      var message = 'Request failed (${response.statusCode})';
      try {
        final data = jsonDecode(utf8.decode(response.bodyBytes));
        if (data is Map && data['error'] is String) {
          message = data['error'] as String;
        }
      } catch (_) {
        // keep generic message for non-JSON bodies
      }
      throw ApiException(response.statusCode, message);
    }

    if (response.statusCode == 204 || response.bodyBytes.isEmpty) {
      return null;
    }
    return jsonDecode(utf8.decode(response.bodyBytes));
  }

  Future<bool> _refreshSession() async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': _refreshToken}),
      );
      if (response.statusCode != 200) {
        await clearTokens();
        return false;
      }
      final data =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      await saveTokens(
        data['accessToken'] as String,
        data['refreshToken'] as String,
      );
      return true;
    } catch (_) {
      return false;
    }
  }
}
