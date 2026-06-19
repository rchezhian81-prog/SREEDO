import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/portal_widgets.dart';
import 'staff_homework_detail_screen.dart';

/// Staff homework list with a "New homework" creator (gated on
/// homework:create). Tap a row to review submissions.
class StaffHomeworkScreen extends StatefulWidget {
  const StaffHomeworkScreen({super.key});

  @override
  State<StaffHomeworkScreen> createState() => _StaffHomeworkScreenState();
}

class _StaffHomeworkScreenState extends State<StaffHomeworkScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/homework');
    return data as List<dynamic>;
  }

  Future<void> _create() async {
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => const _NewHomeworkDialog(),
    );
    if (created == true && mounted) {
      setState(() => _future = _fetch());
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Homework')),
      floatingActionButton: auth.can('homework:create')
          ? FloatingActionButton.extended(
              onPressed: _create,
              icon: const Icon(Icons.add),
              label: const Text('New homework'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _fetch());
          await _future;
        },
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ErrorRetry(
                message: snap.error.toString(),
                onRetry: () => setState(() => _future = _fetch()),
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No homework yet.',
                    icon: Icons.assignment_outlined,
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final hw = items[index] as Map<String, dynamic>;
                return _HomeworkCard(homework: hw);
              },
            );
          },
        ),
      ),
    );
  }
}

class _HomeworkCard extends StatelessWidget {
  const _HomeworkCard({required this.homework});

  final Map<String, dynamic> homework;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = (homework['title'] as String?) ?? '(untitled)';
    final subject = homework['subjectName'] as String?;
    final className = homework['className'] as String?;
    final section = homework['sectionName'] as String?;
    final due = _formatDate(homework['dueDate']);
    final attachments = (homework['attachmentCount'] as num?)?.toInt() ?? 0;
    final classLabel = [className, section]
        .where((e) => e != null && e.isNotEmpty)
        .join(' ');
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(title),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (subject != null && subject.isNotEmpty) Text(subject),
            if (classLabel.isNotEmpty) Text(classLabel),
            if (due != null) Text('Due $due'),
            if (attachments > 0)
              Text('$attachments attachment${attachments == 1 ? '' : 's'}'),
          ],
        ),
        isThreeLine: true,
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute<void>(
            builder: (_) => StaffHomeworkDetailScreen(
              homeworkId: homework['id'] as String,
              title: title,
            ),
          ),
        ),
      ),
    );
  }
}

/// New-homework dialog: pick a section + subject, fill title/description/due.
class _NewHomeworkDialog extends StatefulWidget {
  const _NewHomeworkDialog();

  @override
  State<_NewHomeworkDialog> createState() => _NewHomeworkDialogState();
}

class _NewHomeworkDialogState extends State<_NewHomeworkDialog> {
  Future<List<List<dynamic>>>? _future;
  String? _sectionId;
  String? _subjectId;
  DateTime? _dueDate;
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _descController = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descController.dispose();
    super.dispose();
  }

  Future<List<List<dynamic>>> _fetch() async {
    final api = context.read<ApiClient>();
    final classes = await api.get('/classes') as List<dynamic>;
    final subjects = await api.get('/subjects') as List<dynamic>;
    return [classes, subjects];
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _dueDate = picked);
  }

  Future<void> _save() async {
    final sectionId = _sectionId;
    final subjectId = _subjectId;
    final title = _titleController.text.trim();
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    if (sectionId == null || subjectId == null || title.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Section, subject and title are required.'),
        ),
      );
      return;
    }
    final desc = _descController.text.trim();
    setState(() => _saving = true);
    try {
      await api.post('/homework', body: {
        'sectionId': sectionId,
        'subjectId': subjectId,
        'title': title,
        if (desc.isNotEmpty) 'description': desc,
        if (_dueDate != null)
          'dueDate': DateFormat('yyyy-MM-dd').format(_dueDate!),
      });
      if (!mounted) return;
      navigator.pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New homework'),
      content: SizedBox(
        width: double.maxFinite,
        child: FutureBuilder<List<List<dynamic>>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const SizedBox(
                height: 120,
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (snap.hasError) {
              return SizedBox(
                height: 120,
                child: ErrorRetry(
                  message: snap.error.toString(),
                  onRetry: () => setState(() => _future = _fetch()),
                ),
              );
            }
            final classes = snap.data![0];
            final subjects = snap.data![1];
            final sections = <Map<String, dynamic>>[];
            for (final raw in classes) {
              final c = raw as Map<String, dynamic>;
              final className = (c['name'] as String?) ?? '';
              for (final s in c['sections'] as List<dynamic>? ?? const []) {
                final sec = s as Map<String, dynamic>;
                sections.add({
                  'id': sec['id'],
                  'name': '$className ${(sec['name'] as String?) ?? ''}'.trim(),
                });
              }
            }
            final sectionIds = <String>{
              for (final s in sections) s['id'] as String,
            };
            final subjectIds = <String>{
              for (final s in subjects)
                (s as Map<String, dynamic>)['id'] as String,
            };
            return ListView(
              shrinkWrap: true,
              children: [
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
                        child: Text(s['name'] as String),
                      ),
                  ],
                  onChanged: (v) => setState(() => _sectionId = v),
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
                      _subjectItem(raw as Map<String, dynamic>),
                  ],
                  onChanged: (v) => setState(() => _subjectId = v),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _titleController,
                  decoration: const InputDecoration(
                    labelText: 'Title',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _descController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today),
                  label: Text(
                    _dueDate == null
                        ? 'Pick due date'
                        : DateFormat.yMMMd().format(_dueDate!),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Create'),
        ),
      ],
    );
  }
}

DropdownMenuItem<String> _subjectItem(Map<String, dynamic> subject) {
  final id = subject['id'] as String;
  final name = (subject['name'] as String?) ?? 'Subject';
  return DropdownMenuItem<String>(value: id, child: Text(name));
}

String? _formatDate(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().format(parsed);
}
