import 'package:flutter/foundation.dart';

import '../core/api_client.dart';

/// A student the signed-in user may view: themselves (student) or a linked
/// child (parent). Returned by the owner-scoped /portal/children endpoint.
class Child {
  Child({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.admissionNo,
    this.className,
    this.sectionName,
    this.relationship,
  });

  factory Child.fromJson(Map<String, dynamic> json) => Child(
        id: json['id'] as String,
        admissionNo: json['admissionNo'] as String?,
        firstName: (json['firstName'] as String?) ?? '',
        lastName: (json['lastName'] as String?) ?? '',
        className: json['className'] as String?,
        sectionName: json['sectionName'] as String?,
        relationship: json['relationship'] as String?,
      );

  final String id;
  final String? admissionNo;
  final String firstName;
  final String lastName;
  final String? className;
  final String? sectionName;
  final String? relationship;

  String get name => '$firstName $lastName'.trim();
}

/// Holds the set of accessible children and the currently selected one, shared
/// across the portal tabs so the parent's child selector drives every screen.
class PortalProvider extends ChangeNotifier {
  PortalProvider(this._api);

  final ApiClient _api;

  List<Child> children = [];
  String? selectedId;
  bool loading = false;
  String? error;

  Child? get selected {
    for (final c in children) {
      if (c.id == selectedId) return c;
    }
    return null;
  }

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await _api.get('/portal/children');
      children = (data as List<dynamic>)
          .map((e) => Child.fromJson(e as Map<String, dynamic>))
          .toList();
      if (children.isEmpty) {
        selectedId = null;
      } else if (selected == null) {
        selectedId = children.first.id;
      }
    } on ApiException catch (e) {
      error = e.message;
    } catch (_) {
      error = 'Unable to reach the server';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void select(String id) {
    selectedId = id;
    notifyListeners();
  }

  void reset() {
    children = [];
    selectedId = null;
    error = null;
    notifyListeners();
  }
}
