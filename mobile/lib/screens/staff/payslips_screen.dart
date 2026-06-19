import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../widgets/portal_widgets.dart';

/// The signed-in staff member's payslips, with a per-row PDF download.
class PayslipsScreen extends StatefulWidget {
  const PayslipsScreen({super.key});

  @override
  State<PayslipsScreen> createState() => _PayslipsScreenState();
}

class _PayslipsScreenState extends State<PayslipsScreen> {
  Future<List<dynamic>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/payroll/payslips/mine');
    if (data is List) return data;
    if (data is Map<String, dynamic>) {
      return (data['data'] as List<dynamic>?) ?? const [];
    }
    return const [];
  }

  Future<void> _download(Map<String, dynamic> payslip) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final id = payslip['id'] as String;
    setState(() => _busyId = id);
    try {
      await FileService.openRemote(
        api,
        '/payroll/payslips/$id/pdf',
        'payslip-$id.pdf',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Payslips')),
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
            final payslips = snap.data!;
            if (payslips.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No payslips yet.',
                    icon: Icons.payments_outlined,
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: payslips.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final payslip = payslips[index] as Map<String, dynamic>;
                final id = payslip['id'] as String?;
                final month = (payslip['month'] as String?) ?? 'Payslip';
                final net = payslip['net'];
                final status = payslip['status'] as String?;
                final busy = id != null && _busyId == id;
                return Card(
                  elevation: 0,
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: ListTile(
                    title: Text(month),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 4),
                        if (net != null) Text('Net: $net'),
                        if (status != null && status.isNotEmpty) Text(status),
                      ],
                    ),
                    trailing: IconButton(
                      tooltip: 'Download',
                      onPressed: id == null || busy
                          ? null
                          : () => _download(payslip),
                      icon: busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.download),
                    ),
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
