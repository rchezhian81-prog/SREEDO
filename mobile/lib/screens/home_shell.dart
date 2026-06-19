import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/portal_provider.dart';
import 'announcements_screen.dart';
import 'dashboard_screen.dart';
import 'portal/fees_screen.dart';
import 'portal/homework_screen.dart';
import 'portal/notices_screen.dart';
import 'portal/portal_home_screen.dart';
import 'portal/portal_profile_screen.dart';
import 'profile_screen.dart';

class _Tab {
  const _Tab(this.icon, this.selectedIcon, this.label, this.screen);
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Widget screen;
}

/// Role-aware bottom-nav shell: student/parent get the portal tabs; staff keep
/// the existing dashboard. Tabs are an IndexedStack so state is preserved.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const List<_Tab> _portalTabs = [
    _Tab(Icons.home_outlined, Icons.home, 'Home', PortalHomeScreen()),
    _Tab(Icons.receipt_long_outlined, Icons.receipt_long, 'Fees', FeesScreen()),
    _Tab(Icons.assignment_outlined, Icons.assignment, 'Homework',
        HomeworkScreen()),
    _Tab(Icons.campaign_outlined, Icons.campaign, 'Notices', NoticesScreen()),
    _Tab(Icons.person_outline, Icons.person, 'Profile', PortalProfileScreen()),
  ];

  static const List<_Tab> _staffTabs = [
    _Tab(Icons.dashboard_outlined, Icons.dashboard, 'Dashboard',
        DashboardScreen()),
    _Tab(Icons.campaign_outlined, Icons.campaign, 'Notices',
        AnnouncementsScreen()),
    _Tab(Icons.person_outline, Icons.person, 'Profile', ProfileScreen()),
  ];

  @override
  void initState() {
    super.initState();
    if (context.read<AuthProvider>().isPortal) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.read<PortalProvider>().load();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final tabs = auth.isPortal ? _portalTabs : _staffTabs;
    if (_index >= tabs.length) _index = 0;

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: [for (final t in tabs) t.screen],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final t in tabs)
            NavigationDestination(
              icon: Icon(t.icon),
              selectedIcon: Icon(t.selectedIcon),
              label: t.label,
            ),
        ],
      ),
    );
  }
}
