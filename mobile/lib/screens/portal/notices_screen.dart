import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';
import 'inbox_screen.dart';

/// School-wide announcements for parents/students, with a shortcut to the
/// personal communication inbox.
class NoticesScreen extends StatefulWidget {
  const NoticesScreen({super.key});

  @override
  State<NoticesScreen> createState() => _NoticesScreenState();
}

class _NoticesScreenState extends State<NoticesScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/announcements?limit=50');
    final map = data as Map<String, dynamic>;
    return (map['data'] as List<dynamic>?) ?? const [];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notices'),
        actions: [
          IconButton(
            tooltip: 'Inbox',
            icon: const Icon(Icons.mail_outline),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(builder: (_) => const InboxScreen()),
            ),
          ),
        ],
      ),
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
            final notices = snap.data!;
            if (notices.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No announcements yet.',
                    icon: Icons.campaign_outlined,
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: notices.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final notice = notices[index] as Map<String, dynamic>;
                return _NoticeCard(notice: notice);
              },
            );
          },
        ),
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.notice});

  final Map<String, dynamic> notice;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = (notice['title'] as String?) ?? '(untitled)';
    final body = (notice['body'] as String?) ?? '';
    final isPinned = notice['isPinned'] == true;
    final published = _formatDate(notice['publishedAt']);
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
                if (isPinned) ...[
                  Icon(
                    Icons.push_pin,
                    size: 16,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                ],
                Expanded(
                  child: Text(title, style: theme.textTheme.titleMedium),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(body, maxLines: 3, overflow: TextOverflow.ellipsis),
            if (published != null) ...[
              const SizedBox(height: 8),
              Text(published, style: theme.textTheme.bodySmall),
            ],
          ],
        ),
      ),
    );
  }
}

String? _formatDate(Object? value) {
  if (value is! String) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  return DateFormat.yMMMd().format(parsed.toLocal());
}
