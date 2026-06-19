import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../providers/portal_provider.dart';
import '../../widgets/portal_widgets.dart';

/// Report cards for the selected child: pick an exam, then download the PDF.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Future<List<dynamic>>? _future;
  String? _examId;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/exams');
    return data as List<dynamic>;
  }

  Future<void> _download(String childId) async {
    final examId = _examId;
    if (examId == null) return;
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      await FileService.openRemote(
        api,
        '/reports/report-card?examId=$examId&studentId=$childId',
        'report-card.pdf',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e.statusCode == 404 ? 'No report card available yet.' : e.message,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    final child = portal.selected;
    return Scaffold(
      appBar: AppBar(title: const Text('Report cards')),
      body: child == null
          ? const EmptyHint(message: 'No student linked to your account.')
          : Column(
              children: [
                const ChildSelector(),
                Expanded(
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
                          onRetry: () => setState(() => _future = _fetch()),
                        );
                      }
                      final exams = snap.data!;
                      if (exams.isEmpty) {
                        return const EmptyHint(
                          message: 'No exams published yet.',
                        );
                      }
                      final ids = <String>{
                        for (final raw in exams)
                          (raw as Map<String, dynamic>)['id'] as String,
                      };
                      final value =
                          ids.contains(_examId) ? _examId : null;
                      return ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          DropdownButtonFormField<String>(
                            value: value,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Exam',
                              border: OutlineInputBorder(),
                            ),
                            items: [
                              for (final raw in exams)
                                _examItem(raw as Map<String, dynamic>),
                            ],
                            onChanged: (v) => setState(() => _examId = v),
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _examId == null || _downloading
                                ? null
                                : () => _download(child.id),
                            icon: _downloading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.download),
                            label: const Text('Download report card'),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }
}

DropdownMenuItem<String> _examItem(Map<String, dynamic> exam) {
  final id = exam['id'] as String;
  final name = (exam['name'] as String?) ?? 'Exam';
  return DropdownMenuItem<String>(value: id, child: Text(name));
}
