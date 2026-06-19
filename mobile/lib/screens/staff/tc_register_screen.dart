import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Transfer certificate register: list issued/pending TCs.
class TcRegisterScreen extends StatefulWidget {
  const TcRegisterScreen({super.key});

  @override
  State<TcRegisterScreen> createState() => _TcRegisterScreenState();
}

class _TcRegisterScreenState extends State<TcRegisterScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/transfer-certificates');
    return data as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Transfer Certs')),
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
            final certs = snap.data!;
            if (certs.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No transfer certificates yet.',
                    icon: Icons.description_outlined,
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: certs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final tc = certs[index] as Map<String, dynamic>;
                return _TcCard(tc: tc);
              },
            );
          },
        ),
      ),
    );
  }
}

class _TcCard extends StatelessWidget {
  const _TcCard({required this.tc});

  final Map<String, dynamic> tc;

  @override
  Widget build(BuildContext context) {
    final tcNo = tc['tcNo'] as String?;
    final studentName = (tc['studentName'] as String?) ?? 'Student';
    final admission = tc['admissionNo'] as String?;
    final className = tc['className'] as String?;
    final status = tc['status'] as String?;
    final issued = _formatDate(tc['dateOfIssue']);
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(studentName),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (tcNo != null && tcNo.isNotEmpty) Text('TC No. $tcNo'),
            if (admission != null && admission.isNotEmpty) Text(admission),
            if (className != null && className.isNotEmpty) Text(className),
            if (issued != null) Text('Issued $issued'),
          ],
        ),
        isThreeLine: true,
        trailing: status != null && status.isNotEmpty
            ? Chip(
                label: Text(status),
                visualDensity: VisualDensity.compact,
              )
            : null,
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
