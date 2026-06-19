import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../widgets/portal_widgets.dart';

/// Tracks an online-payment order after returning from the gateway checkout.
/// Polls the order on open and on demand, then renders by status.
class PaymentResultScreen extends StatefulWidget {
  const PaymentResultScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<PaymentResultScreen> createState() => _PaymentResultScreenState();
}

class _PaymentResultScreenState extends State<PaymentResultScreen> {
  Future<Map<String, dynamic>>? _future;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<Map<String, dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final data = await api.get('/online-payments/${widget.orderId}');
    return data as Map<String, dynamic>;
  }

  Future<void> _downloadReceipt() async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      await FileService.openRemote(
        api,
        '/online-payments/${widget.orderId}/receipt',
        'receipt.pdf',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
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
          final order = snap.data!;
          final status = (order['status'] as String?) ?? 'pending';
          final amount = (order['amount'] as num?)?.toDouble();
          return _ResultBody(
            status: status,
            amount: amount,
            downloading: _downloading,
            onRefresh: () => setState(() => _future = _fetch()),
            onDownloadReceipt: _downloadReceipt,
            onDone: () => Navigator.of(context).pop(),
          );
        },
      ),
    );
  }
}

class _ResultBody extends StatelessWidget {
  const _ResultBody({
    required this.status,
    required this.amount,
    required this.downloading,
    required this.onRefresh,
    required this.onDownloadReceipt,
    required this.onDone,
  });

  final String status;
  final double? amount;
  final bool downloading;
  final VoidCallback onRefresh;
  final VoidCallback onDownloadReceipt;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final IconData icon;
    final Color color;
    final String title;
    final bool isSuccess;
    final bool isPending;
    switch (status) {
      case 'success':
        icon = Icons.check_circle;
        color = Colors.green;
        title = 'Payment successful';
        isSuccess = true;
        isPending = false;
        break;
      case 'failed':
      case 'expired':
        icon = Icons.error;
        color = Colors.red;
        title = status == 'expired' ? 'Payment expired' : 'Payment failed';
        isSuccess = false;
        isPending = false;
        break;
      case 'cancelled':
        icon = Icons.cancel;
        color = Colors.amber;
        title = 'Payment cancelled';
        isSuccess = false;
        isPending = false;
        break;
      case 'refunded':
        icon = Icons.undo;
        color = Colors.blue;
        title = 'Payment refunded';
        isSuccess = false;
        isPending = false;
        break;
      default:
        icon = Icons.hourglass_top;
        color = theme.colorScheme.primary;
        title = 'Payment processing';
        isSuccess = false;
        isPending = true;
    }
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 24),
        Icon(icon, size: 72, color: color),
        const SizedBox(height: 16),
        Center(child: Text(title, style: theme.textTheme.titleLarge)),
        if (amount != null) ...[
          const SizedBox(height: 8),
          Center(
            child: Text(
              'Amount: ${amount!.toStringAsFixed(2)}',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
        const SizedBox(height: 32),
        if (isSuccess)
          FilledButton.icon(
            onPressed: downloading ? null : onDownloadReceipt,
            icon: downloading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download),
            label: const Text('Download receipt'),
          ),
        if (isPending)
          FilledButton.tonalIcon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh'),
          ),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onDone, child: const Text('Done')),
      ],
    );
  }
}
