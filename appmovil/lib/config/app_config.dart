import 'dart:developer' as developer;

import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  static String? _wsUrl;
  static String? _authToken;

  static Future<void> load() async {
    try {
      await dotenv.load(fileName: '.env');
      developer.log('.env cargado correctamente', name: 'AppConfig');
      developer.log('AUTH_TOKEN: ${dotenv.env['AUTH_TOKEN']?.substring(0, 10)}...', name: 'AppConfig');
    } catch (e) {
      developer.log('Error cargando .env: $e', name: 'AppConfig');
    }
  }

  static String get wsUrl {
    _wsUrl ??= dotenv.env['WS_URL'] ?? 'ws://localhost:3000/ws';
    return _wsUrl!;
  }

  static String get authToken {
    _authToken ??= dotenv.env['AUTH_TOKEN'] ?? '';
    return _authToken!;
  }

  static bool get isConfigured => authToken.isNotEmpty;
}
