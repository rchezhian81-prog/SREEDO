import 'package:flutter/foundation.dart';

import '../core/api_client.dart';

class DashboardStats {
  DashboardStats({
    required this.activeStudents,
    required this.activeTeachers,
    required this.classes,
    required this.attendanceMarked,
    required this.attendancePresent,
    required this.pendingInvoices,
    required this.totalCollected,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    final attendance = json['attendanceToday'] as Map<String, dynamic>;
    final fees = json['fees'] as Map<String, dynamic>;
    return DashboardStats(
      activeStudents: json['activeStudents'] as int,
      activeTeachers: json['activeTeachers'] as int,
      classes: json['classes'] as int,
      attendanceMarked: attendance['marked'] as int,
      attendancePresent: attendance['present'] as int,
      pendingInvoices: fees['pendingInvoices'] as int,
      totalCollected: (fees['totalCollected'] as num).toDouble(),
    );
  }

  final int activeStudents;
  final int activeTeachers;
  final int classes;
  final int attendanceMarked;
  final int attendancePresent;
  final int pendingInvoices;
  final double totalCollected;
}

class DashboardProvider extends ChangeNotifier {
  DashboardProvider(this._api);

  final ApiClient _api;

  DashboardStats? stats;
  bool loading = false;
  String? error;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await _api.get('/dashboard/stats');
      stats = DashboardStats.fromJson(data as Map<String, dynamic>);
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
