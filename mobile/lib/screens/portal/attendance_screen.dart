import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../providers/portal_provider.dart';
import '../../widgets/portal_widgets.dart';

/// Attendance for the selected child: a monthly summary (rate + counts) from the
/// portal summary endpoint, plus the most recent ~30 days of daily records.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  String? _loadedFor;
  Future<List<dynamic>>? _future;

  Future<List<dynamic>> _fetch(ApiClient api, String id) async {
    final now = DateTime.now();
    final from = now.subtract(const Duration(days: 30));
    final fmt = DateFormat('yyyy-MM-dd');
    final results = await Future.wait([
      api.get('/portal/students/$id/summary'),
      api.get(
        '/attendance/students/$id?from=${fmt.format(from)}&to=${fmt.format(now)}',
      ),
    ]);
    return results;
  }

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    final child = portal.selected;
    final api = context.read<ApiClient>();
    if (child != null && _loadedFor != child.id) {
      _loadedFor = child.id;
      _future = _fetch(api, child.id);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: child == null
          ? const EmptyHint(message: 'No student linked to your account.')
          : Column(
              children: [
                const ChildSelector(),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async {
                      setState(() => _future = _fetch(api, child.id));
                      await _future;
                    },
                    child: FutureBuilder<List<dynamic>>(
                      future: _future,
                      builder: (context, snap) {
                        if (snap.connectionState != ConnectionState.done) {
                          return const Center(
                            child: CircularProgressIndicator(),
                          );
                        }
                        if (snap.hasError) {
                          return ErrorRetry(
                            message: snap.error.toString(),
                            onRetry: () => setState(
                              () => _future = _fetch(api, child.id),
                            ),
                          );
                        }
                        final results = snap.data!;
                        final summary = results[0] as Map<String, dynamic>;
                        final attendance =
                            summary['attendance'] as Map<String, dynamic>? ??
                                const {};
                        final records = results[1] as List<dynamic>;
                        return _AttendanceBody(
                          attendance: attendance,
                          records: records,
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _AttendanceBody extends StatelessWidget {
  const _AttendanceBody({required this.attendance, required this.records});

  final Map<String, dynamic> attendance;
  final List<dynamic> records;

  int _count(String key) => (attendance[key] as num?)?.toInt() ?? 0;

  @override
  Widget build(BuildContext context) {
    final rate = attendance['rate'];
    final rateLabel = rate is num ? '${rate.toInt()}%' : '—';
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.6,
          children: [
            _SummaryCard(label: 'Rate', value: rateLabel, icon: Icons.percent),
            _SummaryCard(
              label: 'Present',
              value: '${_count('present')}',
              icon: Icons.event_available,
            ),
            _SummaryCard(
              label: 'Absent',
              value: '${_count('absent')}',
              icon: Icons.event_busy,
            ),
            _SummaryCard(
              label: 'Late',
              value: '${_count('late')}',
              icon: Icons.schedule,
            ),
            _SummaryCard(
              label: 'Excused',
              value: '${_count('excused')}',
              icon: Icons.verified_user_outlined,
            ),
            _SummaryCard(
              label: 'Total',
              value: '${_count('total')}',
              icon: Icons.calendar_month,
            ),
          ],
        ),
        const SizedBox(height: 24),
        Text('Last 30 days', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (records.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: EmptyHint(message: 'No attendance recorded yet.'),
          )
        else
          for (final raw in records)
            _AttendanceRow(record: raw as Map<String, dynamic>),
      ],
    );
  }
}

class _AttendanceRow extends StatelessWidget {
  const _AttendanceRow({required this.record});

  final Map<String, dynamic> record;

  @override
  Widget build(BuildContext context) {
    final dateStr = record['date'] as String?;
    String label = dateStr ?? '—';
    if (dateStr != null) {
      final parsed = DateTime.tryParse(dateStr);
      if (parsed != null) label = DateFormat.yMMMEd().format(parsed);
    }
    final status = (record['status'] as String?) ?? 'unknown';
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(label),
        trailing: _StatusChip(status: status),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'present':
        color = Colors.green;
        break;
      case 'absent':
        color = Colors.red;
        break;
      case 'late':
        color = Colors.orange;
        break;
      case 'excused':
        color = Colors.blue;
        break;
      default:
        color = Theme.of(context).colorScheme.outline;
    }
    return Chip(
      label: Text(status),
      visualDensity: VisualDensity.compact,
      side: BorderSide(color: color),
      labelStyle: TextStyle(color: color),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
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
