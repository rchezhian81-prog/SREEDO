import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../widgets/portal_widgets.dart';

/// Staff student search: type a query, list matching students.
class StudentSearchScreen extends StatefulWidget {
  const StudentSearchScreen({super.key});

  @override
  State<StudentSearchScreen> createState() => _StudentSearchScreenState();
}

class _StudentSearchScreenState extends State<StudentSearchScreen> {
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
    final data = await api.get('/students?search=$query&limit=20');
    final map = data as Map<String, dynamic>;
    return (map['data'] as List<dynamic>?) ?? const [];
  }

  void _search() {
    setState(() => _future = _fetch(_controller.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Students')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _controller,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                labelText: 'Search students',
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
                final students = snap.data!;
                if (students.isEmpty) {
                  return const EmptyHint(
                    message: 'No students found.',
                    icon: Icons.school_outlined,
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: students.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final s = students[index] as Map<String, dynamic>;
                    return _StudentCard(student: s);
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

class _StudentCard extends StatelessWidget {
  const _StudentCard({required this.student});

  final Map<String, dynamic> student;

  @override
  Widget build(BuildContext context) {
    final first = (student['firstName'] as String?) ?? '';
    final last = (student['lastName'] as String?) ?? '';
    final admission = student['admissionNo'] as String?;
    final className = student['className'] as String?;
    final section = student['sectionName'] as String?;
    final classLabel = [className, section]
        .where((e) => e != null && e.isNotEmpty)
        .join(' ');
    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: ListTile(
        title: Text('$first $last'.trim()),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (admission != null && admission.isNotEmpty) Text(admission),
            if (classLabel.isNotEmpty) Text(classLabel),
          ],
        ),
      ),
    );
  }
}
