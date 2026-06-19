import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Fee dues overview: summary KPIs plus the outstanding-fees report rows.
class FeeDuesScreen extends StatefulWidget {
  const FeeDuesScreen({super.key});

  @override
  State<FeeDuesScreen> createState() => _FeeDuesScreenState();
}

class _FeeDuesScreenState extends State<FeeDuesScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final summary =
        await api.get('/fees/summary') as Map<String, dynamic>;
    final report = await api.get('/report-center/fee_outstanding')
        as Map<String, dynamic>;
    return [summary, report];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fee Dues')),
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
            final summary = snap.data![0] as Map<String, dynamic>;
            final report = snap.data![1] as Map<String, dynamic>;
            final columns = (report['columns'] as List<dynamic>? ?? const [])
                .map((e) => e as Map<String, dynamic>)
                .toList();
            final allRows = (report['rows'] as List<dynamic>? ?? const [])
                .map((e) => e as Map<String, dynamic>)
                .toList();
            final rows = allRows.take(50).toList();
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 1.4,
                  children: [
                    _StatCard(
                      label: 'Invoiced',
                      value: _money(summary['totalInvoiced']),
                      icon: Icons.request_quote,
                    ),
                    _StatCard(
                      label: 'Collected',
                      value: _money(summary['totalCollected']),
                      icon: Icons.payments,
                    ),
                    _StatCard(
                      label: 'Outstanding',
                      value: _money(summary['outstanding']),
                      icon: Icons.warning_amber,
                    ),
                    _StatCard(
                      label: 'Pending invoices',
                      value: '${(summary['pendingInvoices'] as num?)?.toInt() ?? 0}',
                      icon: Icons.receipt_long,
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  'Outstanding dues',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                if (columns.isEmpty || rows.isEmpty)
                  const EmptyHint(
                    message: 'No outstanding dues.',
                    icon: Icons.check_circle_outline,
                  )
                else
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columns: [
                        for (final c in columns)
                          DataColumn(
                            label: Text((c['label'] as String?) ?? '—'),
                          ),
                      ],
                      rows: [
                        for (final row in rows)
                          DataRow(
                            cells: [
                              for (final c in columns)
                                DataCell(Text(_cell(row[c['key']]))),
                            ],
                          ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: scheme.primary),
            const SizedBox(height: 8),
            Text(value, style: Theme.of(context).textTheme.headlineSmall),
            Text(label, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

String _money(Object? value) {
  if (value is num) return value.toStringAsFixed(2);
  return '0.00';
}

String _cell(Object? value) {
  if (value == null) return '';
  return value.toString();
}
