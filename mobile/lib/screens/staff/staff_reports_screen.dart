import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';
import 'report_view_screen.dart';

/// Report center: lists available reports grouped by category. Tap one to run
/// it in the report viewer.
class StaffReportsScreen extends StatefulWidget {
  const StaffReportsScreen({super.key});

  @override
  State<StaffReportsScreen> createState() => _StaffReportsScreenState();
}

class _StaffReportsScreenState extends State<StaffReportsScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/report-center');
    return data as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
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
            final reports = snap.data!;
            if (reports.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No reports available.',
                    icon: Icons.assessment_outlined,
                  ),
                ],
              );
            }
            final byCategory = <String, List<Map<String, dynamic>>>{};
            for (final raw in reports) {
              final r = raw as Map<String, dynamic>;
              final category = (r['category'] as String?) ?? 'Other';
              byCategory.putIfAbsent(category, () => []).add(r);
            }
            final categories = byCategory.keys.toList()..sort();
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final category in categories) ...[
                  Text(
                    category,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  for (final report in byCategory[category]!)
                    _ReportCard(report: report),
                  const SizedBox(height: 16),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});

  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final title = (report['title'] as String?) ?? 'Report';
    final key = report['key'] as String?;
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(title),
        trailing: const Icon(Icons.chevron_right),
        onTap: key == null
            ? null
            : () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => ReportViewScreen(
                      reportKey: key,
                      title: title,
                    ),
                  ),
                ),
      ),
    );
  }
}
