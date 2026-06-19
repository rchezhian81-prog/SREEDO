import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/dashboard_provider.dart';
import 'staff/attendance_mark_screen.dart';
import 'staff/fee_dues_screen.dart';
import 'staff/marks_entry_screen.dart';
import 'staff/my_timetable_screen.dart';
import 'staff/payslips_screen.dart';
import 'staff/staff_communication_screen.dart';
import 'staff/staff_directory_screen.dart';
import 'staff/staff_homework_screen.dart';
import 'staff/staff_reports_screen.dart';
import 'staff/student_search_screen.dart';
import 'staff/tc_register_screen.dart';

/// Staff hub: KPIs from /dashboard/stats plus a permission-gated grid of quick
/// actions that push the staff feature screens.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<DashboardProvider>();
    final auth = context.watch<AuthProvider>();
    final stats = provider.stats;

    final actions = <_QuickAction>[
      if (auth.role == 'teacher')
        _QuickAction(
          label: 'My Timetable',
          icon: Icons.calendar_today,
          builder: (_) => const MyTimetableScreen(),
        ),
      if (auth.role == 'admin' || auth.role == 'teacher')
        _QuickAction(
          label: 'Mark Attendance',
          icon: Icons.event_available,
          builder: (_) => const AttendanceMarkScreen(),
        ),
      if (auth.role == 'admin' || auth.role == 'teacher')
        _QuickAction(
          label: 'Marks Entry',
          icon: Icons.grading,
          builder: (_) => const MarksEntryScreen(),
        ),
      if (auth.can('homework:read'))
        _QuickAction(
          label: 'Homework',
          icon: Icons.assignment,
          builder: (_) => const StaffHomeworkScreen(),
        ),
      if (auth.can('communication:read'))
        _QuickAction(
          label: 'Communication',
          icon: Icons.mail,
          builder: (_) => const StaffCommunicationScreen(),
        ),
      if (auth.can('reports:center:read'))
        _QuickAction(
          label: 'Reports',
          icon: Icons.assessment,
          builder: (_) => const StaffReportsScreen(),
        ),
      if (auth.can('payroll:payslip'))
        _QuickAction(
          label: 'My Payslips',
          icon: Icons.payments,
          builder: (_) => const PayslipsScreen(),
        ),
      if (auth.isStaff)
        _QuickAction(
          label: 'Students',
          icon: Icons.school,
          builder: (_) => const StudentSearchScreen(),
        ),
      if (auth.isStaff)
        _QuickAction(
          label: 'Staff Directory',
          icon: Icons.badge,
          builder: (_) => const StaffDirectoryScreen(),
        ),
      if (auth.can('fee_reports:read'))
        _QuickAction(
          label: 'Fee Dues',
          icon: Icons.receipt_long,
          builder: (_) => const FeeDuesScreen(),
        ),
      if (auth.can('transfer_certificates:read'))
        _QuickAction(
          label: 'Transfer Certs',
          icon: Icons.description,
          builder: (_) => const TcRegisterScreen(),
        ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => context.read<DashboardProvider>().load(),
        child: provider.loading && stats == null
            ? const Center(child: CircularProgressIndicator())
            : provider.error != null && stats == null
                ? _ErrorView(message: provider.error!)
                : ListView(
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
                            label: 'Students',
                            value: '${stats?.activeStudents ?? 0}',
                            icon: Icons.school,
                          ),
                          _StatCard(
                            label: 'Teachers',
                            value: '${stats?.activeTeachers ?? 0}',
                            icon: Icons.badge,
                          ),
                          _StatCard(
                            label: 'Present today',
                            value: stats != null && stats.attendanceMarked > 0
                                ? '${stats.attendancePresent}/${stats.attendanceMarked}'
                                : '—',
                            icon: Icons.event_available,
                          ),
                          _StatCard(
                            label: 'Pending invoices',
                            value: '${stats?.pendingInvoices ?? 0}',
                            icon: Icons.receipt_long,
                          ),
                        ],
                      ),
                      if (actions.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        Text(
                          'Quick actions',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 12),
                        GridView.count(
                          crossAxisCount: 2,
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          childAspectRatio: 1.6,
                          children: [
                            for (final action in actions)
                              _ActionTile(action: action),
                          ],
                        ),
                      ],
                    ],
                  ),
      ),
    );
  }
}

class _QuickAction {
  const _QuickAction({
    required this.label,
    required this.icon,
    required this.builder,
  });

  final String label;
  final IconData icon;
  final WidgetBuilder builder;
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.action});

  final _QuickAction action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      color: scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute<void>(builder: action.builder),
        ),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(action.icon, color: scheme.primary),
              const SizedBox(height: 8),
              Text(
                action.label,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ],
          ),
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

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 120),
        Icon(
          Icons.cloud_off,
          size: 48,
          color: Theme.of(context).colorScheme.outline,
        ),
        const SizedBox(height: 12),
        Center(child: Text(message)),
      ],
    );
  }
}
