import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/portal_widgets.dart';

/// Staff view of a homework: details, attachments to download, and the list of
/// student submissions with an optional review action (gated on homework:review).
class StaffHomeworkDetailScreen extends StatefulWidget {
  const StaffHomeworkDetailScreen({
    super.key,
    required this.homeworkId,
    required this.title,
  });

  final String homeworkId;
  final String title;

  @override
  State<StaffHomeworkDetailScreen> createState() =>
      _StaffHomeworkDetailScreenState();
}

class _StaffHomeworkDetailScreenState extends State<StaffHomeworkDetailScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final hw = await api.get('/homework/${widget.homeworkId}')
        as Map<String, dynamic>;
    final submissions = await api
        .get('/homework/${widget.homeworkId}/submissions') as List<dynamic>;
    return [hw, submissions];
  }

  Future<void> _download(Map<String, dynamic> attachment) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final id = attachment['id'] as String;
    final name = (attachment['originalName'] as String?) ?? 'attachment';
    try {
      await FileService.openRemote(
        api,
        '/homework/attachments/$id/download',
        name,
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _review(Map<String, dynamic> submission) async {
    final reviewed = await showDialog<bool>(
      context: context,
      builder: (_) => _ReviewDialog(submission: submission),
    );
    if (reviewed == true && mounted) {
      setState(() => _future = _fetch());
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canReview = auth.can('homework:review');
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
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
            final hw = snap.data![0] as Map<String, dynamic>;
            final submissions = snap.data![1] as List<dynamic>;
            final theme = Theme.of(context);
            final subject = hw['subjectName'] as String?;
            final due = _formatDate(hw['dueDate']);
            final description = hw['description'] as String?;
            final instructions = hw['instructions'] as String?;
            final attachments = hw['attachments'];
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (subject != null && subject.isNotEmpty)
                  Text(subject, style: theme.textTheme.titleMedium),
                if (due != null) ...[
                  const SizedBox(height: 4),
                  Text('Due $due', style: theme.textTheme.bodySmall),
                ],
                if (description != null && description.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('Description', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(description),
                ],
                if (instructions != null && instructions.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('Instructions', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(instructions),
                ],
                if (attachments is List && attachments.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('Attachments', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  for (final raw in attachments)
                    _AttachmentTile(
                      attachment: raw as Map<String, dynamic>,
                      onDownload: () => _download(raw),
                    ),
                ],
                const SizedBox(height: 24),
                Text('Submissions', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                if (submissions.isEmpty)
                  const EmptyHint(
                    message: 'No submissions yet.',
                    icon: Icons.assignment_turned_in_outlined,
                  )
                else
                  for (final raw in submissions)
                    _SubmissionCard(
                      submission: raw as Map<String, dynamic>,
                      onReview: canReview
                          ? () => _review(raw)
                          : null,
                    ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _SubmissionCard extends StatelessWidget {
  const _SubmissionCard({required this.submission, this.onReview});

  final Map<String, dynamic> submission;
  final VoidCallback? onReview;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = (submission['studentName'] as String?) ?? 'Student';
    final status = submission['status'] as String?;
    final content = submission['content'] as String?;
    final marks = submission['marks'];
    final remarks = submission['remarks'] as String?;
    final submittedAt = _formatDateTime(submission['submittedAt']);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(name, style: theme.textTheme.titleMedium),
                ),
                if (status != null && status.isNotEmpty)
                  Chip(
                    label: Text(status),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            if (content != null && content.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(content),
            ],
            if (marks != null) ...[
              const SizedBox(height: 4),
              Text('Marks: $marks'),
            ],
            if (remarks != null && remarks.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('Remarks: $remarks'),
            ],
            if (submittedAt != null) ...[
              const SizedBox(height: 4),
              Text(submittedAt, style: theme.textTheme.bodySmall),
            ],
            if (onReview != null) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: onReview,
                  icon: const Icon(Icons.rate_review),
                  label: const Text('Review'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AttachmentTile extends StatelessWidget {
  const _AttachmentTile({required this.attachment, required this.onDownload});

  final Map<String, dynamic> attachment;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final name = (attachment['originalName'] as String?) ?? 'Attachment';
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        leading: const Icon(Icons.attach_file),
        title: Text(name),
        trailing: IconButton(
          tooltip: 'Open',
          icon: const Icon(Icons.download),
          onPressed: onDownload,
        ),
        onTap: onDownload,
      ),
    );
  }
}

/// Review dialog: set a status, optional marks and remarks.
class _ReviewDialog extends StatefulWidget {
  const _ReviewDialog({required this.submission});

  final Map<String, dynamic> submission;

  @override
  State<_ReviewDialog> createState() => _ReviewDialogState();
}

class _ReviewDialogState extends State<_ReviewDialog> {
  static const List<String> _statuses = [
    'submitted',
    'reviewed',
    'completed',
    'late',
    'resubmit',
  ];

  late String _status;
  final TextEditingController _marksController = TextEditingController();
  final TextEditingController _remarksController = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final current = widget.submission['status'] as String?;
    _status = _statuses.contains(current) ? current! : 'reviewed';
    final marks = widget.submission['marks'];
    if (marks != null) _marksController.text = marks.toString();
    final remarks = widget.submission['remarks'] as String?;
    if (remarks != null) _remarksController.text = remarks;
  }

  @override
  void dispose() {
    _marksController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final sid = widget.submission['id'] as String;
    final marksText = _marksController.text.trim();
    final remarks = _remarksController.text.trim();
    setState(() => _saving = true);
    try {
      await api.post('/homework/submissions/$sid/review', body: {
        'status': _status,
        if (marksText.isNotEmpty) 'marks': num.tryParse(marksText) ?? marksText,
        if (remarks.isNotEmpty) 'remarks': remarks,
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
      title: const Text('Review submission'),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            DropdownButtonFormField<String>(
              value: _status,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Status',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final s in _statuses)
                  DropdownMenuItem<String>(value: s, child: Text(s)),
              ],
              onChanged: (v) => setState(() => _status = v ?? _status),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _marksController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Marks',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _remarksController,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Remarks',
                border: OutlineInputBorder(),
              ),
            ),
          ],
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
              : const Text('Save'),
        ),
      ],
    );
  }
}

String? _formatDate(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().format(parsed);
}

String? _formatDateTime(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().add_jm().format(parsed.toLocal());
}
