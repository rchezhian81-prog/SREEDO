import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sreedo_mobile/widgets/portal_widgets.dart';

void main() {
  testWidgets('ErrorRetry renders its message', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ErrorRetry(message: 'x')),
      ),
    );
    expect(find.text('x'), findsOneWidget);
  });
}
