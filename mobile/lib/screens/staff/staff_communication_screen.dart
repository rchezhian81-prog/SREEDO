import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/portal_widgets.dart';

/// Staff communication: an Inbox / Sent toggle plus a Compose dialog gated on
/// communication:send. Opening an unread inbox message marks it read.
class StaffCommunicationScreen extends StatefulWidget {
  const StaffCommunicationScreen({super.key});

  @override
  State<StaffCommunicationScreen> createState() =>
      _StaffCommunicationScreenState();
}

class _StaffCommunicationScreenState extends State<StaffCommunicationScreen> {
  int _tab = 0;
  Future<List<dynamic>>? _inboxFuture;
  Future<List<dynamic>>? _sentFuture;

  @override
  void initState() {
    super.initState();
    _inboxFuture = _fetchInbox();
    _sentFuture = _fetchSent();
  }

  Future<List<dynamic>> _fetchInbox() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/communication/inbox');
    return data as List<dynamic>;
  }

  Future<List<dynamic>> _fetchSent() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/communication/messages');
    return data as List<dynamic>;
  }

  Future<void> _openInbox(Map<String, dynamic> message) async {
    if (message['readAt'] != null) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final id = message['id'] as String;
    try {
      await api.post('/communication/inbox/$id/read');
      if (!mounted) return;
      setState(() => _inboxFuture = _fetchInbox());
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _compose() async {
    final sent = await showDialog<bool>(
      context: context,
      builder: (_) => const _ComposeDialog(),
    );
    if (sent == true && mounted) {
      setState(() {
        _tab = 1;
        _sentFuture = _fetchSent();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Communication')),
      floatingActionButton: auth.can('communication:send')
          ? FloatingActionButton.extended(
              onPressed: _compose,
              icon: const Icon(Icons.edit),
              label: const Text('Compose'),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: SegmentedButton<int>(
              segments: const [
                ButtonSegment<int>(value: 0, label: Text('Inbox')),
                ButtonSegment<int>(value: 1, label: Text('Sent')),
              ],
              selected: {_tab},
              onSelectionChanged: (s) => setState(() => _tab = s.first),
            ),
          ),
          Expanded(
            child: _tab == 0 ? _buildInbox() : _buildSent(),
          ),
        ],
      ),
    );
  }

  Widget _buildInbox() {
    return RefreshIndicator(
      onRefresh: () async {
        setState(() => _inboxFuture = _fetchInbox());
        await _inboxFuture;
      },
      child: FutureBuilder<List<dynamic>>(
        future: _inboxFuture,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ErrorRetry(
              message: snap.error.toString(),
              onRetry: () => setState(() => _inboxFuture = _fetchInbox()),
            );
          }
          final messages = snap.data!;
          if (messages.isEmpty) {
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 120),
                EmptyHint(
                  message: 'No messages yet.',
                  icon: Icons.mail_outline,
                ),
              ],
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: messages.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final message = messages[index] as Map<String, dynamic>;
              return _InboxCard(
                message: message,
                onTap: () => _openInbox(message),
              );
            },
          );
        },
      ),
    );
  }

  Widget _buildSent() {
    return RefreshIndicator(
      onRefresh: () async {
        setState(() => _sentFuture = _fetchSent());
        await _sentFuture;
      },
      child: FutureBuilder<List<dynamic>>(
        future: _sentFuture,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ErrorRetry(
              message: snap.error.toString(),
              onRetry: () => setState(() => _sentFuture = _fetchSent()),
            );
          }
          final messages = snap.data!;
          if (messages.isEmpty) {
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 120),
                EmptyHint(
                  message: 'Nothing sent yet.',
                  icon: Icons.send_outlined,
                ),
              ],
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: messages.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final message = messages[index] as Map<String, dynamic>;
              return _SentCard(message: message);
            },
          );
        },
      ),
    );
  }
}

class _InboxCard extends StatelessWidget {
  const _InboxCard({required this.message, required this.onTap});

  final Map<String, dynamic> message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUnread = message['readAt'] == null;
    final subject = (message['subject'] as String?) ?? '(no subject)';
    final body = (message['body'] as String?) ?? '';
    final sender = message['senderName'] as String?;
    final createdAt = _formatDateTime(message['createdAt']);
    final weight = isUnread ? FontWeight.bold : FontWeight.normal;
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: ListTile(
        onTap: onTap,
        leading: isUnread
            ? Icon(Icons.circle, size: 12, color: theme.colorScheme.primary)
            : const Icon(Icons.circle_outlined, size: 12),
        title: Text(
          subject,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: weight),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (sender != null && sender.isNotEmpty)
              Text(sender, style: theme.textTheme.bodySmall),
            Text(body, maxLines: 2, overflow: TextOverflow.ellipsis),
            if (createdAt != null) ...[
              const SizedBox(height: 4),
              Text(createdAt, style: theme.textTheme.bodySmall),
            ],
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}

class _SentCard extends StatelessWidget {
  const _SentCard({required this.message});

  final Map<String, dynamic> message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final subject = (message['subject'] as String?) ?? '(no subject)';
    final category = message['category'] as String?;
    final recipients = (message['recipientCount'] as num?)?.toInt() ?? 0;
    final read = (message['readCount'] as num?)?.toInt() ?? 0;
    final createdAt = _formatDateTime(message['createdAt']);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(subject),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (category != null && category.isNotEmpty) Text(category),
            Text('Read $read / $recipients'),
            if (createdAt != null)
              Text(createdAt, style: theme.textTheme.bodySmall),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}

/// Compose dialog: subject, body, category, audience type and optional ref.
class _ComposeDialog extends StatefulWidget {
  const _ComposeDialog();

  @override
  State<_ComposeDialog> createState() => _ComposeDialogState();
}

class _ComposeDialogState extends State<_ComposeDialog> {
  static const List<String> _categories = [
    'message',
    'announcement',
    'general',
  ];
  static const List<String> _audiences = [
    'all_students',
    'all_parents',
    'staff',
    'section',
    'class',
    'student',
    'parent',
    'user',
  ];
  static const Set<String> _needsRef = {
    'section',
    'class',
    'student',
    'parent',
    'user',
  };

  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _bodyController = TextEditingController();
  final TextEditingController _refController = TextEditingController();
  String _category = 'message';
  String _audience = 'all_students';
  bool _saving = false;

  @override
  void dispose() {
    _subjectController.dispose();
    _bodyController.dispose();
    _refController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final subject = _subjectController.text.trim();
    final body = _bodyController.text.trim();
    final ref = _refController.text.trim();
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    if (subject.isEmpty || body.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Subject and body are required.')),
      );
      return;
    }
    if (_needsRef.contains(_audience) && ref.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('An audience reference (UUID) is required.'),
        ),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await api.post('/communication/messages', body: {
        'subject': subject,
        'body': body,
        'category': _category,
        'audienceType': _audience,
        if (_needsRef.contains(_audience)) 'audienceRef': ref,
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
    final showRef = _needsRef.contains(_audience);
    return AlertDialog(
      title: const Text('Compose'),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            TextField(
              controller: _subjectController,
              decoration: const InputDecoration(
                labelText: 'Subject',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _bodyController,
              minLines: 3,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: 'Body',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _category,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Category',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final c in _categories)
                  DropdownMenuItem<String>(value: c, child: Text(c)),
              ],
              onChanged: (v) => setState(() => _category = v ?? _category),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _audience,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Audience',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final a in _audiences)
                  DropdownMenuItem<String>(value: a, child: Text(a)),
              ],
              onChanged: (v) => setState(() => _audience = v ?? _audience),
            ),
            if (showRef) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _refController,
                decoration: const InputDecoration(
                  labelText: 'Audience reference (UUID)',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _send,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Send'),
        ),
      ],
    );
  }
}

String? _formatDateTime(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().add_jm().format(parsed.toLocal());
}
