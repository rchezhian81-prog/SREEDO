import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import 'api_client.dart';

/// Downloads protected PDFs/attachments (bearer-authed) and opens them with the
/// platform viewer. Tenant/owner scoping is enforced server-side; we only ever
/// fetch what the signed-in user is allowed to see.
class FileService {
  static Future<String> openRemote(
    ApiClient api,
    String path,
    String filename,
  ) async {
    final bytes = await api.getBytes(path);
    final dir = await getTemporaryDirectory();
    final safe = filename.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File('${dir.path}/$safe');
    await file.writeAsBytes(bytes, flush: true);
    final result = await OpenFilex.open(file.path);
    return result.message;
  }
}
