import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Admin/teacher marks entry: pick exam + class/section + subject, load the
/// roster, type marks per student against a shared max, then save.
class MarksEntryScreen extends StatefulWidget {
  const MarksEntryScreen({super.key});

  @override
  State<MarksEntryScreen> createState() => _MarksEntryScreenState();
}

class _MarksEntryScreenState extends State<MarksEntryScreen> {
  Future<List<List<dynamic>>>? _pickersFuture;
  String? _examId;
  String? _classId;
  String? _sectionId;
  String? _subjectId;

  final TextEditingController _maxMarksController =
      TextEditingController(text: '100');
  bool _loading = false;
  bool _saving = false;
  List<Map<String, dynamic>> _roster = [];
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _pickersFuture = _fetchPickers();
  }

  @override
  void dispose() {
    _maxMarksController.dispose();
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<List<List<dynamic>>> _fetchPickers() async {
    final api = context.read<ApiClient>();
    final exams = await api.get('/exams') as List<dynamic>;
    final classes = await api.get('/classes') as List<dynamic>;
    final subjects = await api.get('/subjects') as List<dynamic>;
    return [exams, classes, subjects];
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

  void _clearControllers() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    _controllers.clear();
  }

  Future<void> _load() async {
    final sectionId = _sectionId;
    if (sectionId == null) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    setState(() => _loading = true);
    try {
      final data = await api.get(
        '/attendance?sectionId=$sectionId&date=$today',
      ) as List<dynamic>;
      final rows = [for (final r in data) r as Map<String, dynamic>];
      _clearControllers();
      for (final r in rows) {
        _controllers[r['studentId'] as String] = TextEditingController();
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
    final examId = _examId;
    final subjectId = _subjectId;
    if (examId == null || subjectId == null || _roster.isEmpty) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final maxMarks = num.tryParse(_maxMarksController.text.trim()) ?? 100;
    final results = <Map<String, dynamic>>[];
    for (final r in _roster) {
      final id = r['studentId'] as String;
      final text = _controllers[id]?.text.trim() ?? '';
      if (text.isEmpty) continue;
      final value = num.tryParse(text);
      if (value == null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Marks must be numeric.')),
        );
        return;
      }
      if (value > maxMarks) {
        messenger.showSnackBar(
          SnackBar(content: Text('Marks cannot exceed $maxMarks.')),
        );
        return;
      }
      results.add({
        'studentId': id,
        'subjectId': subjectId,
        'marksObtained': value,
        'maxMarks': maxMarks,
      });
    }
    if (results.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Enter at least one mark.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await api.post('/exams/$examId/results', body: {'results': results});
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Marks saved.')),
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
      appBar: AppBar(title: const Text('Marks Entry')),
      body: FutureBuilder<List<List<dynamic>>>(
        future: _pickersFuture,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ErrorRetry(
              message: snap.error.toString(),
              onRetry: () =>
                  setState(() => _pickersFuture = _fetchPickers()),
            );
          }
          final data = snap.data!;
          final exams = data[0];
          final classes = data[1];
          final subjects = data[2];
          final sections = _sectionsFor(classes);
          final examIds = <String>{
            for (final e in exams) (e as Map<String, dynamic>)['id'] as String,
          };
          final classIds = <String>{
            for (final c in classes)
              (c as Map<String, dynamic>)['id'] as String,
          };
          final subjectIds = <String>{
            for (final s in subjects)
              (s as Map<String, dynamic>)['id'] as String,
          };
          final sectionIds = <String>{
            for (final s in sections) s['id'] as String,
          };
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              DropdownButtonFormField<String>(
                value: examIds.contains(_examId) ? _examId : null,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Exam',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final raw in exams)
                    _namedItem(raw as Map<String, dynamic>),
                ],
                onChanged: (v) => setState(() => _examId = v),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: classIds.contains(_classId) ? _classId : null,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Class',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final raw in classes)
                    _namedItem(raw as Map<String, dynamic>),
                ],
                onChanged: (v) => setState(() {
                  _classId = v;
                  _sectionId = null;
                  _roster = [];
                  _clearControllers();
                }),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: sectionIds.contains(_sectionId) ? _sectionId : null,
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
                  _clearControllers();
                }),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: subjectIds.contains(_subjectId) ? _subjectId : null,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Subject',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final raw in subjects)
                    _namedItem(raw as Map<String, dynamic>),
                ],
                onChanged: (v) => setState(() => _subjectId = v),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _maxMarksController,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                ],
                decoration: const InputDecoration(
                  labelText: 'Max marks',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _sectionId == null || _loading ? null : _load,
                icon: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download),
                label: const Text('Load roster'),
              ),
              const SizedBox(height: 16),
              if (_roster.isEmpty)
                const EmptyHint(
                  message: 'Pick the exam, section and subject, then load.',
                  icon: Icons.grading,
                )
              else ...[
                for (final r in _roster) _studentRow(r),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed:
                      _saving || _examId == null || _subjectId == null
                          ? null
                          : _save,
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
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$first $last'.trim()),
                  if (admission != null && admission.isNotEmpty)
                    Text(
                      admission,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 90,
              child: TextField(
                controller: _controllers[id],
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                ],
                decoration: const InputDecoration(
                  labelText: 'Marks',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

DropdownMenuItem<String> _namedItem(Map<String, dynamic> item) {
  final id = item['id'] as String;
  final name = (item['name'] as String?) ?? '—';
  return DropdownMenuItem<String>(value: id, child: Text(name));
}
