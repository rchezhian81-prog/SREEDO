import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Communication inbox for the signed-in user. Unread messages are emphasised;
/// opening an unread message marks it read on the server and refreshes.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/communication/inbox');
    return data as List<dynamic>;
  }

  Future<void> _open(Map<String, dynamic> message) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final isUnread = message['readAt'] == null;
    if (isUnread) {
      final id = message['id'] as String;
      try {
        await api.post('/communication/inbox/$id/read');
        if (!mounted) return;
        setState(() => _future = _fetch());
      } on ApiException catch (e) {
        if (!mounted) return;
        messenger.showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Inbox')),
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
                return _MessageCard(
                  message: message,
                  onTap: () => _open(message),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.message, required this.onTap});

  final Map<String, dynamic> message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUnread = message['readAt'] == null;
    final subject = (message['subject'] as String?) ?? '(no subject)';
    final body = (message['body'] as String?) ?? '';
    final sender = message['senderName'] as String?;
    final createdAt = _formatDate(message['createdAt']);
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

String? _formatDate(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().add_jm().format(parsed.toLocal());
}
