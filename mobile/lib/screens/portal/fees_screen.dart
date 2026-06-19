import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../providers/portal_provider.dart';
import '../../widgets/portal_widgets.dart';
import 'payment_result_screen.dart';

/// Fee invoices for the selected child, split into pending and paid. Pending
/// invoices offer an online-payment flow that opens the gateway checkout and
/// then tracks the order on the result screen.
class FeesScreen extends StatefulWidget {
  const FeesScreen({super.key});

  @override
  State<FeesScreen> createState() => _FeesScreenState();
}

class _FeesScreenState extends State<FeesScreen> {
  String? _loadedFor;
  Future<List<dynamic>>? _future;
  String? _busyInvoiceId;

  Future<List<dynamic>> _fetch(ApiClient api, String id) async {
    final data = await api.get('/fees/invoices?studentId=$id');
    final map = data as Map<String, dynamic>;
    return (map['data'] as List<dynamic>?) ?? const [];
  }

  Future<void> _pay(Map<String, dynamic> invoice) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _busyInvoiceId = invoice['id'] as String?);
    try {
      final order = await api.post(
        '/online-payments',
        body: {'invoiceId': invoice['id']},
      ) as Map<String, dynamic>;
      final checkoutUrl = order['checkoutUrl'] as String?;
      if (checkoutUrl != null && checkoutUrl.isNotEmpty) {
        await launchUrl(
          Uri.parse(checkoutUrl),
          mode: LaunchMode.externalApplication,
        );
      }
      if (!mounted) return;
      await navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => PaymentResultScreen(orderId: order['id'] as String),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 503) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'Online payment is not available right now. '
              'Please pay at the school office.',
            ),
          ),
        );
      } else {
        messenger.showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busyInvoiceId = null);
    }
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
      appBar: AppBar(title: const Text('Fees')),
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
                        final invoices = snap.data!;
                        if (invoices.isEmpty) {
                          return ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: const [
                              SizedBox(height: 120),
                              EmptyHint(
                                message: 'No invoices yet.',
                                icon: Icons.receipt_long,
                              ),
                            ],
                          );
                        }
                        final pending = <Map<String, dynamic>>[];
                        final paid = <Map<String, dynamic>>[];
                        for (final raw in invoices) {
                          final inv = raw as Map<String, dynamic>;
                          final status = inv['status'] as String?;
                          if (status == 'pending' ||
                              status == 'partially_paid') {
                            pending.add(inv);
                          } else {
                            paid.add(inv);
                          }
                        }
                        return ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.all(16),
                          children: [
                            if (pending.isNotEmpty) ...[
                              Text(
                                'Pending',
                                style:
                                    Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 8),
                              for (final inv in pending)
                                _InvoiceCard(
                                  invoice: inv,
                                  busy: _busyInvoiceId == inv['id'],
                                  onPay: () => _pay(inv),
                                ),
                              const SizedBox(height: 16),
                            ],
                            if (paid.isNotEmpty) ...[
                              Text(
                                'Paid',
                                style:
                                    Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 8),
                              for (final inv in paid)
                                _InvoiceCard(invoice: inv),
                            ],
                          ],
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

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({required this.invoice, this.onPay, this.busy = false});

  final Map<String, dynamic> invoice;
  final VoidCallback? onPay;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final invoiceNo = invoice['invoiceNo'] as String?;
    final description = invoice['description'] as String?;
    final due = (invoice['amountDue'] as num?)?.toDouble() ?? 0;
    final paidAmount = (invoice['amountPaid'] as num?)?.toDouble() ?? 0;
    final outstanding = (due - paidAmount).clamp(0, double.infinity);
    final dueDate = _formatDate(invoice['dueDate']);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              description?.isNotEmpty == true
                  ? description!
                  : (invoiceNo ?? 'Invoice'),
              style: theme.textTheme.titleMedium,
            ),
            if (invoiceNo != null) ...[
              const SizedBox(height: 4),
              Text('No. $invoiceNo', style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: 8),
            Text('Amount due: ${due.toStringAsFixed(2)}'),
            Text('Paid: ${paidAmount.toStringAsFixed(2)}'),
            Text('Outstanding: ${outstanding.toStringAsFixed(2)}'),
            if (dueDate != null) ...[
              const SizedBox(height: 4),
              Text('Due $dueDate', style: theme.textTheme.bodySmall),
            ],
            if (onPay != null) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: busy ? null : onPay,
                icon: busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.payment),
                label: const Text('Pay online'),
              ),
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
  return DateFormat.yMMMd().format(parsed);
}
