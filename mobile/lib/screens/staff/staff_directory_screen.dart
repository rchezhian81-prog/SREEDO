import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Staff directory: search teachers, with tap-to-call / tap-to-email actions.
class StaffDirectoryScreen extends StatefulWidget {
  const StaffDirectoryScreen({super.key});

  @override
  State<StaffDirectoryScreen> createState() => _StaffDirectoryScreenState();
}

class _StaffDirectoryScreenState extends State<StaffDirectoryScreen> {
  final TextEditingController _controller = TextEditingController();
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch('');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<List<dynamic>> _fetch(String search) async {
    final api = context.read<ApiClient>();
    final query = Uri.encodeQueryComponent(search);
    final data = await api.get('/teachers?search=$query');
    return data as List<dynamic>;
  }

  void _search() {
    setState(() => _future = _fetch(_controller.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Staff Directory')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _controller,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                labelText: 'Search staff',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.search),
                  onPressed: _search,
                ),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<dynamic>>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  return ErrorRetry(
                    message: snap.error.toString(),
                    onRetry: _search,
                  );
                }
                final teachers = snap.data!;
                if (teachers.isEmpty) {
                  return const EmptyHint(
                    message: 'No staff found.',
                    icon: Icons.badge_outlined,
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: teachers.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final t = teachers[index] as Map<String, dynamic>;
                    return _TeacherCard(teacher: t);
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TeacherCard extends StatelessWidget {
  const _TeacherCard({required this.teacher});

  final Map<String, dynamic> teacher;

  @override
  Widget build(BuildContext context) {
    final first = (teacher['firstName'] as String?) ?? '';
    final last = (teacher['lastName'] as String?) ?? '';
    final employeeNo = teacher['employeeNo'] as String?;
    final email = teacher['email'] as String?;
    final phone = teacher['phone'] as String?;
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text('$first $last'.trim()),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (employeeNo != null && employeeNo.isNotEmpty) Text(employeeNo),
            if (email != null && email.isNotEmpty) Text(email),
            if (phone != null && phone.isNotEmpty) Text(phone),
          ],
        ),
        isThreeLine: true,
        trailing: phone != null && phone.isNotEmpty
            ? IconButton(
                tooltip: 'Call',
                icon: const Icon(Icons.call),
                onPressed: () =>
                    launchUrl(Uri(scheme: 'tel', path: phone)),
              )
            : null,
      ),
    );
  }
}
