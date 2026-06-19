import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Admin/teacher attendance marking: pick a class + section + date, load the
/// roster, set a per-student status, then save in one POST.
class AttendanceMarkScreen extends StatefulWidget {
  const AttendanceMarkScreen({super.key});

  @override
  State<AttendanceMarkScreen> createState() => _AttendanceMarkScreenState();
}

class _AttendanceMarkScreenState extends State<AttendanceMarkScreen> {
  static const List<String> _statuses = [
    'present',
    'absent',
    'late',
    'excused',
  ];

  Future<List<dynamic>>? _classesFuture;
  String? _classId;
  String? _sectionId;
  DateTime _date = DateTime.now();

  bool _loading = false;
  bool _saving = false;
  List<Map<String, dynamic>> _roster = [];
  final Map<String, String> _marks = {};

  @override
  void initState() {
    super.initState();
    _classesFuture = _fetchClasses();
  }

  Future<List<dynamic>> _fetchClasses() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/classes');
    return data as List<dynamic>;
  }

  List<Map<String, dynamic>> _sectionsFor(List<dynamic> classes) {
    for (final raw in classes) {
      final c = raw as Map<String, dynamic>;
      if (c['id'] == _classId) {
        final sections = c['sections'] as List<dynamic>? ?? const [];
        return [for (final s in sections) s as Map<String, dynamic>];
      }
    }
    return const [];
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _load() async {
    final sectionId = _sectionId;
    if (sectionId == null) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final dateStr = DateFormat('yyyy-MM-dd').format(_date);
    setState(() => _loading = true);
    try {
      final data = await api.get(
        '/attendance?sectionId=$sectionId&date=$dateStr',
      ) as List<dynamic>;
      final rows = [for (final r in data) r as Map<String, dynamic>];
      _marks.clear();
      for (final r in rows) {
        final id = r['studentId'] as String;
        final status = r['status'] as String?;
        _marks[id] = status ?? 'present';
      }
      if (!mounted) return;
      setState(() => _roster = rows);
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (_roster.isEmpty) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final dateStr = DateFormat('yyyy-MM-dd').format(_date);
    final records = [
      for (final r in _roster)
        {
          'studentId': r['studentId'],
          'status': _marks[r['studentId']] ?? 'present',
        },
    ];
    setState(() => _saving = true);
    try {
      await api.post(
        '/attendance',
        body: {'date': dateStr, 'records': records},
      );
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Attendance saved.')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mark Attendance')),
      body: FutureBuilder<List<dynamic>>(
        future: _classesFuture,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ErrorRetry(
              message: snap.error.toString(),
              onRetry: () =>
                  setState(() => _classesFuture = _fetchClasses()),
            );
          }
          final classes = snap.data!;
          final sections = _sectionsFor(classes);
          final classIds = <String>{
            for (final c in classes) (c as Map<String, dynamic>)['id'] as String,
          };
          final classValue =
              classIds.contains(_classId) ? _classId : null;
          final sectionIds = <String>{
            for (final s in sections) s['id'] as String,
          };
          final sectionValue =
              sectionIds.contains(_sectionId) ? _sectionId : null;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              DropdownButtonFormField<String>(
                value: classValue,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Class',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final raw in classes)
                    _classItem(raw as Map<String, dynamic>),
                ],
                onChanged: (v) => setState(() {
                  _classId = v;
                  _sectionId = null;
                  _roster = [];
                }),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: sectionValue,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Section',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final s in sections)
                    DropdownMenuItem<String>(
                      value: s['id'] as String,
                      child: Text((s['name'] as String?) ?? 'Section'),
                    ),
                ],
                onChanged: (v) => setState(() {
                  _sectionId = v;
                  _roster = [];
                }),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _pickDate,
                icon: const Icon(Icons.calendar_today),
                label: Text(DateFormat.yMMMd().format(_date)),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed:
                    _sectionId == null || _loading ? null : _load,
                icon: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download),
                label: const Text('Load'),
              ),
              const SizedBox(height: 16),
              if (_roster.isEmpty)
                const EmptyHint(
                  message: 'Pick a section and date, then load the roster.',
                  icon: Icons.event_available,
                )
              else ...[
                for (final r in _roster) _studentRow(r),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save),
                  label: const Text('Save'),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _studentRow(Map<String, dynamic> r) {
    final id = r['studentId'] as String;
    final first = (r['firstName'] as String?) ?? '';
    final last = (r['lastName'] as String?) ?? '';
    final admission = r['admissionNo'] as String?;
    final selected = _marks[id] ?? 'present';
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$first $last'.trim()),
            if (admission != null && admission.isNotEmpty)
              Text(
                admission,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final status in _statuses)
                  ChoiceChip(
                    label: Text(_label(status)),
                    selected: selected == status,
                    onSelected: (_) =>
                        setState(() => _marks[id] = status),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _label(String status) =>
    status[0].toUpperCase() + status.substring(1);

DropdownMenuItem<String> _classItem(Map<String, dynamic> c) {
  final id = c['id'] as String;
  final name = (c['name'] as String?) ?? 'Class';
  return DropdownMenuItem<String>(value: id, child: Text(name));
}
