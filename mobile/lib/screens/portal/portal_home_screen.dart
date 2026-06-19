import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/portal_provider.dart';
import '../../widgets/portal_widgets.dart';
import 'attendance_screen.dart';
import 'documents_screen.dart';
import 'inbox_screen.dart';
import 'reports_screen.dart';

/// Portal landing tab: a snapshot of the selected child's attendance and fees,
/// plus quick links into the deeper screens.
class PortalHomeScreen extends StatefulWidget {
  const PortalHomeScreen({super.key});

  @override
  State<PortalHomeScreen> createState() => _PortalHomeScreenState();
}

class _PortalHomeScreenState extends State<PortalHomeScreen> {
  String? _loadedFor;
  Future<Map<String, dynamic>>? _future;

  Future<Map<String, dynamic>> _fetch(ApiClient api, String id) async {
    final data = await api.get('/portal/students/$id/summary');
    return data as Map<String, dynamic>;
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
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
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
                    child: FutureBuilder<Map<String, dynamic>>(
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
                        final data = snap.data!;
                        final attendance =
                            data['attendance'] as Map<String, dynamic>? ??
                                const {};
                        final fees =
                            data['fees'] as Map<String, dynamic>? ?? const {};
                        final rate = attendance['rate'];
                        return ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.all(16),
                          children: [
                            Text(
                              'Hi, ${child.name}',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 16),
                            GridView.count(
                              crossAxisCount: 2,
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              mainAxisSpacing: 12,
                              crossAxisSpacing: 12,
                              childAspectRatio: 1.5,
                              children: [
                                _StatCard(
                                  label: 'Attendance',
                                  value: rate is num ? '${rate.toInt()}%' : '—',
                                  icon: Icons.event_available,
                                ),
                                _StatCard(
                                  label: 'Outstanding',
                                  value: _money(fees['outstanding']),
                                  icon: Icons.account_balance_wallet,
                                ),
                                _StatCard(
                                  label: 'Pending invoices',
                                  value:
                                      '${(fees['pendingInvoices'] as num?)?.toInt() ?? 0}',
                                  icon: Icons.receipt_long,
                                ),
                              ],
                            ),
                            const SizedBox(height: 24),
                            Text(
                              'Quick links',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            _LinkTile(
                              icon: Icons.event_available,
                              label: 'Attendance',
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => const AttendanceScreen(),
                                ),
                              ),
                            ),
                            _LinkTile(
                              icon: Icons.folder_open,
                              label: 'Documents',
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => const DocumentsScreen(),
                                ),
                              ),
                            ),
                            _LinkTile(
                              icon: Icons.assessment_outlined,
                              label: 'Report cards',
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => const ReportsScreen(),
                                ),
                              ),
                            ),
                            _LinkTile(
                              icon: Icons.mail_outline,
                              label: 'Inbox',
                              onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => const InboxScreen(),
                                ),
                              ),
                            ),
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

String _money(Object? value) {
  if (value is num) return value.toStringAsFixed(2);
  return '—';
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

class _LinkTile extends StatelessWidget {
  const _LinkTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        leading: Icon(icon),
        title: Text(label),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
