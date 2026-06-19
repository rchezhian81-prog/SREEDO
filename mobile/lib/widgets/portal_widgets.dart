import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/portal_provider.dart';

/// Inline error state with an optional retry action (offline-friendly copy).
class ErrorRetry extends StatelessWidget {
  const ErrorRetry({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off,
                size: 44, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: onRetry, child: const Text('Retry')),
            ],
          ],
        ),
      ),
    );
  }
}

/// Friendly empty state.
class EmptyHint extends StatelessWidget {
  const EmptyHint({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
  });

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

/// Child selector — a dropdown shown to parents with more than one linked child;
/// hidden for students (single record). Drives every portal screen.
class ChildSelector extends StatelessWidget {
  const ChildSelector({super.key});

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    if (portal.children.length <= 1) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: DropdownButtonFormField<String>(
        value: portal.selectedId,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Viewing',
          border: OutlineInputBorder(),
          isDense: true,
        ),
        items: [
          for (final c in portal.children)
            DropdownMenuItem(value: c.id, child: Text(c.name)),
        ],
        onChanged: (v) {
          if (v != null) portal.select(v);
        },
      ),
    );
  }
}
