import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../widgets/portal_widgets.dart';

/// Homework detail with description, instructions, attachments to download, and
/// a text submission form.
class HomeworkDetailScreen extends StatefulWidget {
  const HomeworkDetailScreen({
    super.key,
    required this.homeworkId,
    required this.title,
  });

  final String homeworkId;
  final String title;

  @override
  State<HomeworkDetailScreen> createState() => _HomeworkDetailScreenState();
}

class _HomeworkDetailScreenState extends State<HomeworkDetailScreen> {
  Future<Map<String, dynamic>>? _future;
  final TextEditingController _controller = TextEditingController();
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/homework/${widget.homeworkId}');
    return data as Map<String, dynamic>;
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

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _submitting = true);
    try {
      await api.postMultipart(
        '/homework/${widget.homeworkId}/submit',
        fields: {'content': text},
      );
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Submission sent.')),
      );
      setState(() => _future = _fetch());
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: FutureBuilder<Map<String, dynamic>>(
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
          final hw = snap.data!;
          final theme = Theme.of(context);
          final subject = hw['subjectName'] as String?;
          final due = _formatDate(hw['dueDate']);
          final description = hw['description'] as String?;
          final instructions = hw['instructions'] as String?;
          final attachments = hw['attachments'];
          final submission = hw['submission'];
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
              Text('Your submission', style: theme.textTheme.titleSmall),
              if (submission is Map && submission['content'] is String) ...[
                const SizedBox(height: 8),
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(submission['content'] as String),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              TextField(
                controller: _controller,
                minLines: 3,
                maxLines: 6,
                enabled: !_submitting,
                decoration: const InputDecoration(
                  labelText: 'Write your answer',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
                label: const Text('Submit'),
              ),
            ],
          );
        },
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

String? _formatDate(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().format(parsed);
}
