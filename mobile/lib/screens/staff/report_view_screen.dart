import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../widgets/portal_widgets.dart';

/// Runs a single report-center report and renders its columns/rows in a
/// scrollable DataTable, with a PDF export action.
class ReportViewScreen extends StatefulWidget {
  const ReportViewScreen({
    super.key,
    required this.reportKey,
    required this.title,
  });

  final String reportKey;
  final String title;

  @override
  State<ReportViewScreen> createState() => _ReportViewScreenState();
}

class _ReportViewScreenState extends State<ReportViewScreen> {
  Future<Map<String, dynamic>>? _future;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<Map<String, dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/report-center/${widget.reportKey}');
    return data as Map<String, dynamic>;
  }

  Future<void> _export() async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _exporting = true);
    try {
      await FileService.openRemote(
        api,
        '/report-center/${widget.reportKey}/export?format=pdf',
        '${widget.reportKey}.pdf',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: 'Export PDF',
            onPressed: _exporting ? null : _export,
            icon: _exporting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.picture_as_pdf),
          ),
        ],
      ),
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
          final report = snap.data!;
          final columns = (report['columns'] as List<dynamic>? ?? const [])
              .map((e) => e as Map<String, dynamic>)
              .toList();
          final rows = (report['rows'] as List<dynamic>? ?? const [])
              .map((e) => e as Map<String, dynamic>)
              .toList();
          if (columns.isEmpty || rows.isEmpty) {
            return const EmptyHint(
              message: 'No data for this report.',
              icon: Icons.table_chart_outlined,
            );
          }
          return SingleChildScrollView(
            scrollDirection: Axis.vertical,
            child: SingleChildScrollView(
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
                          DataCell(
                            Text(_cell(row[c['key']])),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

String _cell(Object? value) {
  if (value == null) return '';
  return value.toString();
}
