import 'package:flutter/foundation.dart';

import '../core/api_client.dart';

class Announcement {
  Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.audience,
    required this.isPinned,
    required this.publishedAt,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) => Announcement(
        id: json['id'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        audience: json['audience'] as String,
        isPinned: json['isPinned'] as bool,
        publishedAt: DateTime.parse(json['publishedAt'] as String),
      );

  final String id;
  final String title;
  final String body;
  final String audience;
  final bool isPinned;
  final DateTime publishedAt;
}

class AnnouncementsProvider extends ChangeNotifier {
  AnnouncementsProvider(this._api);

  final ApiClient _api;

  List<Announcement> announcements = [];
  bool loading = false;
  String? error;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await _api.get('/announcements?limit=50');
      final items = (data as Map<String, dynamic>)['data'] as List<dynamic>;
      announcements = items
          .map((item) => Announcement.fromJson(item as Map<String, dynamic>))
          .toList();
    } on ApiException catch (e) {
      error = e.message;
    } catch (_) {
      error = 'Unable to reach the server';
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
