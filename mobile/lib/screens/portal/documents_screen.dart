import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../widgets/portal_widgets.dart';

/// Shared documents available to the signed-in user; tapping a row downloads the
/// file (bearer-authed) and opens it with the platform viewer.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/documents');
    return data as List<dynamic>;
  }

  Future<void> _download(Map<String, dynamic> doc) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final id = doc['id'] as String;
    final name = (doc['originalName'] as String?) ?? 'document';
    try {
      await FileService.openRemote(api, '/documents/$id/download', name);
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Documents')),
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
            final docs = snap.data!;
            if (docs.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(message: 'No documents available.'),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: docs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final doc = docs[index] as Map<String, dynamic>;
                final name = (doc['originalName'] as String?) ?? 'Document';
                final category = doc['category'] as String?;
                final size = _humanSize(doc['sizeBytes']);
                return Card(
                  elevation: 0,
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: Text(name),
                    subtitle: Text(
                      [
                        if (category != null && category.isNotEmpty) category,
                        size,
                      ].join(' · '),
                    ),
                    trailing: IconButton(
                      tooltip: 'Open',
                      icon: const Icon(Icons.download),
                      onPressed: () => _download(doc),
                    ),
                    onTap: () => _download(doc),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

String _humanSize(Object? value) {
  if (value is! num) return '';
  var size = value.toDouble();
  const units = ['B', 'KB', 'MB', 'GB'];
  var unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  final rounded = unit == 0 ? size.toStringAsFixed(0) : size.toStringAsFixed(1);
  return '$rounded ${units[unit]}';
}
