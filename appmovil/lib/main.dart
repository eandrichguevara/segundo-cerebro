import 'dart:developer' as developer;

import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'screens/home_screen.dart';
import 'services/audio_service.dart';
import 'services/notification_service.dart';
import 'services/websocket_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();

  if (!AppConfig.isConfigured) {
    developer.log('WARNING: AUTH_TOKEN no configurado', name: 'main');
  }

  final notificationService = NotificationService();
  await notificationService.initialize();

  final wsService = WebSocketService();
  final audioService = AudioService(wsService);
  await audioService.initialize();

  notificationService.connectWs(wsService);

  runApp(
    SegundoCerebroApp(
      wsService: wsService,
      audioService: audioService,
    ),
  );
}

class SegundoCerebroApp extends StatefulWidget {
  final WebSocketService wsService;
  final AudioService audioService;

  const SegundoCerebroApp({
    super.key,
    required this.wsService,
    required this.audioService,
  });

  @override
  State<SegundoCerebroApp> createState() => _SegundoCerebroAppState();
}

class _SegundoCerebroAppState extends State<SegundoCerebroApp> {
  @override
  void dispose() {
    widget.audioService.dispose();
    widget.wsService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Segundo Cerebro',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.blue,
          brightness: Brightness.dark,
        ),
      ),
      home: HomeScreen(
        wsService: widget.wsService,
        audioService: widget.audioService,
      ),
    );
  }
}
