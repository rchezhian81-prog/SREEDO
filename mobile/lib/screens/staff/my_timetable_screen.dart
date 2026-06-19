import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/portal_widgets.dart';

/// The signed-in teacher's weekly timetable, grouped by day with today
/// highlighted. The teacher record is resolved by matching the logged-in
/// user's email against the teachers list.
class MyTimetableScreen extends StatefulWidget {
  const MyTimetableScreen({super.key});

  @override
  State<MyTimetableScreen> createState() => _MyTimetableScreenState();
}

class _MyTimetableScreenState extends State<MyTimetableScreen> {
  Future<List<dynamic>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<dynamic>> _fetch() async {
    final api = context.read<ApiClient>();
    final email = context.read<AuthProvider>().user?.email;
    if (email == null) return const [];
    final teachers = await api.get('/teachers') as List<dynamic>;
    String? teacherId;
    for (final raw in teachers) {
      final t = raw as Map<String, dynamic>;
      if ((t['email'] as String?)?.toLowerCase() == email.toLowerCase()) {
        teacherId = t['id'] as String?;
        break;
      }
    }
    if (teacherId == null) return const [];
    final data = await api.get('/timetable?teacherId=$teacherId');
    return data as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Timetable')),
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
            final entries = snap.data!;
            if (entries.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyHint(
                    message: 'No timetable linked to your account.',
                    icon: Icons.calendar_today_outlined,
                  ),
                ],
              );
            }
            final byDay = <int, List<Map<String, dynamic>>>{};
            for (final raw in entries) {
              final e = raw as Map<String, dynamic>;
              final day = (e['dayOfWeek'] as num?)?.toInt() ?? 0;
              byDay.putIfAbsent(day, () => []).add(e);
            }
            final days = byDay.keys.toList()..sort();
            final today = DateTime.now().weekday;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final day in days) ...[
                  Row(
                    children: [
                      Text(
                        _dayName(day),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (day == today) ...[
                        const SizedBox(width: 8),
                        const Chip(
                          label: Text('Today'),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  for (final entry in byDay[day]!)
                    _PeriodCard(entry: entry, highlight: day == today),
                  const SizedBox(height: 16),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _PeriodCard extends StatelessWidget {
  const _PeriodCard({required this.entry, required this.highlight});

  final Map<String, dynamic> entry;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final period = entry['periodName'] as String?;
    final subject = entry['subjectName'] as String?;
    final section = entry['sectionName'] as String?;
    final room = entry['roomName'] as String?;
    final start = entry['startTime'] as String?;
    final end = entry['endTime'] as String?;
    final time = (start != null && end != null) ? '$start – $end' : start;
    return Card(
      elevation: 0,
      color: highlight
          ? scheme.primaryContainer
          : scheme.surfaceContainerHighest,
      child: ListTile(
        title: Text(subject?.isNotEmpty == true ? subject! : 'Period'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (period != null && period.isNotEmpty) Text(period),
            if (section != null && section.isNotEmpty) Text('Class $section'),
            if (room != null && room.isNotEmpty) Text('Room $room'),
            if (time != null && time.isNotEmpty) Text(time),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}

String _dayName(int day) {
  const names = {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  };
  return names[day] ?? 'Day $day';
}
