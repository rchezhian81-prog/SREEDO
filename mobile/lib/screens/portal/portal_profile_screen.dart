import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/file_service.dart';
import '../../providers/auth_provider.dart';
import '../../providers/portal_provider.dart';
import '../../widgets/portal_widgets.dart';
import 'documents_screen.dart';
import 'reports_screen.dart';

/// Profile tab: the selected child's details, the signed-in account, and links
/// to the ID card, report cards, documents, plus sign-out.
class PortalProfileScreen extends StatefulWidget {
  const PortalProfileScreen({super.key});

  @override
  State<PortalProfileScreen> createState() => _PortalProfileScreenState();
}

class _PortalProfileScreenState extends State<PortalProfileScreen> {
  bool _downloadingIdCard = false;

  Future<void> _downloadIdCard(String childId) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloadingIdCard = true);
    try {
      await FileService.openRemote(
        api,
        '/id-cards/student/$childId/download',
        'id-card.pdf',
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _downloadingIdCard = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    final auth = context.watch<AuthProvider>();
    final child = portal.selected;
    final user = auth.user;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        children: [
          const ChildSelector(),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (child != null) ...[
                  Card(
                    elevation: 0,
                    color: theme.colorScheme.surfaceContainerHighest,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Student', style: theme.textTheme.titleSmall),
                          const SizedBox(height: 8),
                          Text(
                            child.name,
                            style: theme.textTheme.titleMedium,
                          ),
                          if (child.admissionNo != null)
                            Text('Admission no: ${child.admissionNo}'),
                          if (child.className != null)
                            Text(
                              'Class: ${child.className}'
                              '${child.sectionName != null ? ' - ${child.sectionName}' : ''}',
                            ),
                          if (child.relationship != null)
                            Text('Relationship: ${child.relationship}'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ] else
                  const EmptyHint(
                    message: 'No student linked to your account.',
                  ),
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Account', style: theme.textTheme.titleSmall),
                        const SizedBox(height: 8),
                        Text(
                          user?.fullName ?? '',
                          style: theme.textTheme.titleMedium,
                        ),
                        if (user != null) Text(user.email),
                        if (user != null) ...[
                          const SizedBox(height: 8),
                          Chip(
                            label: Text(user.role.toUpperCase()),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                if (child != null) ...[
                  FilledButton.tonalIcon(
                    onPressed: _downloadingIdCard
                        ? null
                        : () => _downloadIdCard(child.id),
                    icon: _downloadingIdCard
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.badge_outlined),
                    label: const Text('ID card (PDF)'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const ReportsScreen(),
                      ),
                    ),
                    icon: const Icon(Icons.assessment_outlined),
                    label: const Text('Report cards'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const DocumentsScreen(),
                      ),
                    ),
                    icon: const Icon(Icons.folder_open),
                    label: const Text('Documents'),
                  ),
                  const SizedBox(height: 24),
                ],
                FilledButton.tonalIcon(
                  onPressed: () => context.read<AuthProvider>().logout(),
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
