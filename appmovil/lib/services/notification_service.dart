import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:typed_data';

import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models/ws_message.dart';
import 'websocket_service.dart';

const _eventChannelId = 'event_notifications';
const _eventChannelName = 'Eventos activos';
const _eventChannelDesc = 'Notificaciones de eventos en curso';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final service = NotificationService._();
  await service._initLocalNotifications();
  await service._handleRemoteMessage(message);
}

class NotificationService {
  final FlutterLocalNotificationsPlugin _notifications;
  FirebaseMessaging? _messaging;
  String? _fcmToken;
  WebSocketService? _wsService;
  bool _isInitialized = false;

  static final NotificationService _instance = NotificationService._();

  factory NotificationService() => _instance;

  NotificationService._()
      : _notifications = FlutterLocalNotificationsPlugin();

  String? get fcmToken => _fcmToken;
  bool get isInitialized => _isInitialized;

  Future<void> initialize() async {
    await _initLocalNotifications();

    if (Platform.isAndroid || Platform.isIOS) {
      await Firebase.initializeApp();
      _messaging = FirebaseMessaging.instance;
      await _requestPermissions();
      _fcmToken = await _messaging!.getToken();
      developer.log('FCM Token: $_fcmToken', name: 'NotificationService');

      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

      _setupForegroundListeners();

      _messaging!.onTokenRefresh.listen((token) {
        _fcmToken = token;
        developer.log('FCM Token refreshed: $token', name: 'NotificationService');
        _sendTokenToWs();
      });
    } else {
      developer.log('FCM not supported on this platform', name: 'NotificationService');
    }

    _isInitialized = true;
  }

  Future<void> _initLocalNotifications() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _notifications.initialize(
      const InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
        macOS: iosSettings,
      ),
    );
    await _createEventChannel();
  }

  Future<void> _createEventChannel() async {
    final androidChannel = AndroidNotificationChannel(
      _eventChannelId,
      _eventChannelName,
      description: _eventChannelDesc,
      importance: Importance.high,
      enableVibration: true,
      playSound: true,
      enableLights: true,
    );
    await _notifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>()?.createNotificationChannel(
      androidChannel,
    );
  }

  Future<void> _requestPermissions() async {
    final settings = await _messaging!.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      announcement: false,
      criticalAlert: false,
    );
    developer.log(
      'FCM permission: ${settings.authorizationStatus}',
      name: 'NotificationService',
    );
  }

  void _setupForegroundListeners() {
    FirebaseMessaging.onMessage.listen(_handleRemoteMessage);
  }

  void connectWs(WebSocketService wsService) {
    _wsService = wsService;
    if (wsService.state == WsConnectionState.authenticated) {
      _sendTokenToWs();
    } else {
      wsService.stateStream.listen((state) {
        if (state == WsConnectionState.authenticated) {
          _sendTokenToWs();
        }
      });
    }
  }

  void _sendTokenToWs() {
    if (_fcmToken == null || _wsService == null) return;
    final platform = Platform.isAndroid ? 'android' : Platform.isIOS ? 'ios' : 'unknown';
    _wsService!.sendMessage(
      RegisterFcmTokenMessage(token: _fcmToken!, platform: platform),
    );
    developer.log('FCM token sent to backend', name: 'NotificationService');
  }

  Future<void> _handleRemoteMessage(RemoteMessage message) async {
    final data = message.data;
    if (data.isEmpty) return;

    final type = data['type'];
    switch (type) {
      case 'event_notification':
        await _handleEventNotification(data);
      case 'event_notification_cancel':
        _handleEventCancel(data);
      default:
        developer.log(
          'Unknown notification type: $type',
          name: 'NotificationService',
        );
    }
  }

  int _notificationIdForEvent(String eventId) {
    var hash = 0;
    for (final codeUnit in eventId.codeUnits) {
      hash = (hash * 31 + codeUnit) & 0x7FFFFFFF;
    }
    return hash;
  }

  Future<void> _handleEventNotification(Map<String, dynamic> data) async {
    final eventJson = data['event'] as String?;
    final linksJson = data['links'] as String?;
    if (eventJson == null) return;

    try {
      final event = jsonDecode(eventJson) as Map<String, dynamic>;
      final eventId = event['id'] as String;
      final title = event['title'] as String? ?? 'Evento';
      final startTime = event['startTime'] as String?;
      final endTime = event['endTime'] as String?;
      final location = event['location'] as String?;
      final description = event['description'] as String?;
      final category = event['category'] as String?;

      final List<Map<String, dynamic>> links = linksJson != null
          ? (jsonDecode(linksJson) as List<dynamic>).cast<Map<String, dynamic>>()
          : [];

      final fullBody = _buildNotificationBody(
        title, startTime, endTime, location, description, category, links,
      );
      final collapsedText = fullBody.isNotEmpty ? fullBody : 'Evento en curso';

      final notificationId = _notificationIdForEvent(eventId);

      final androidDetails = AndroidNotificationDetails(
        _eventChannelId,
        _eventChannelName,
        channelDescription: _eventChannelDesc,
        importance: Importance.high,
        priority: Priority.high,
        ongoing: true,
        autoCancel: false,
        tag: 'event_$eventId',
        showWhen: false,
        usesChronometer: false,
        category: AndroidNotificationCategory.event,
        additionalFlags: Int32List.fromList([32, 128]),
        styleInformation: BigTextStyleInformation(
          fullBody,
          contentTitle: '📅  $title',
          summaryText: 'Evento en curso',
        ),
      );

      await _notifications.show(
        notificationId,
        '📅  $title',
        collapsedText,
        NotificationDetails(android: androidDetails),
      );
    } catch (e) {
      developer.log(
        'Error handling event notification: $e',
        name: 'NotificationService',
      );
    }
  }

  String _buildNotificationBody(
    String title,
    String? startTime,
    String? endTime,
    String? location,
    String? description,
    String? category,
    List<Map<String, dynamic>> links,
  ) {
    final buffer = StringBuffer();

    final timeParts = <String>[];
    if (startTime != null) {
      final start = DateTime.parse(startTime);
      timeParts.add(_formatTime(start));
      if (endTime != null) {
        timeParts.add('- ${_formatTime(DateTime.parse(endTime))}');
      }
    }
    if (location != null) {
      timeParts.add('📍 $location');
    }
    if (category != null) {
      timeParts.add('#$category');
    }
    if (timeParts.isNotEmpty) {
      buffer.writeln(timeParts.join('  '));
    }

    if (description != null && description.isNotEmpty) {
      buffer.writeln(description);
    }

    for (final link in links) {
      buffer.writeln();
      final linkType = link['type'] as String?;
      final linkTitle = link['title'] as String? ?? '';
      final linkDescription = link['description'] as String?;
      final linkNote = link['note'] as String?;
      final status = link['status'] as String?;

      switch (linkType) {
        case 'list':
          buffer.writeln('📋  $linkTitle');
          final items = link['items'] as List<dynamic>?;
          if (items != null) {
            for (final item in items) {
              final content = item['content'] as String? ?? '';
              final checked = item['checked'] as bool? ?? false;
              final quantity = item['quantity'] as String?;
              final suffix = quantity != null ? ' ($quantity)' : '';
              buffer.writeln('  ${checked ? '✅' : '☐'} $content$suffix');
            }
          }
          break;
        case 'task':
          final priority = link['priority'] as String?;
          final deadline = link['deadline'] as String?;
          final statusEmoji = _taskStatusEmoji(status);
          final priorityEmoji = _priorityEmoji(priority);
          buffer.writeln('$statusEmoji $priorityEmoji $linkTitle');
          final meta = _buildTaskMeta(status, deadline);
          if (meta.isNotEmpty) buffer.writeln('  $meta');
          break;
        case 'objective':
          buffer.writeln('🎯  $linkTitle');
          final objectiveMeta = _buildObjectiveMeta(status, link['deadline'] as String?);
          if (objectiveMeta.isNotEmpty) buffer.writeln('  $objectiveMeta');
          break;
        case 'project':
          buffer.writeln('📂  $linkTitle');
          final projectMeta = _buildProjectMeta(status, link['category'] as String?);
          if (projectMeta.isNotEmpty) buffer.writeln('  $projectMeta');
          break;
        case 'idea':
          final tags = link['tags'] as List<dynamic>?;
          buffer.writeln('💡  $linkTitle');
          final ideaMeta = _buildIdeaMeta(status, tags);
          if (ideaMeta.isNotEmpty) buffer.writeln('  $ideaMeta');
          break;
        default:
          if (linkTitle.isNotEmpty) {
            buffer.writeln('• $linkTitle');
          }
      }

      if (linkDescription != null && linkDescription.isNotEmpty) {
        buffer.writeln('  $linkDescription');
      }
      if (linkNote != null && linkNote.isNotEmpty) {
        buffer.writeln('  📝 $linkNote');
      }
    }

    return buffer.toString().trim();
  }

  String _taskStatusEmoji(String? status) {
    return switch (status) {
      'completed' => '✅',
      'in_progress' => '🔄',
      'postponed' => '⏳',
      'cancelled' => '❌',
      _ => '☐',
    };
  }

  String _priorityEmoji(String? priority) {
    return switch (priority) {
      'high' => '🔴',
      'medium' => '🟡',
      'low' => '🟢',
      _ => '',
    };
  }

  String _buildTaskMeta(String? status, String? deadline) {
    final parts = <String>[];
    if (status != null) parts.add(_statusLabel(status));
    if (deadline != null) {
      parts.add('📅 ${_formatDate(DateTime.parse(deadline))}');
    }
    return parts.join(' · ');
  }

  String _buildObjectiveMeta(String? status, String? deadline) {
    final parts = <String>[];
    if (status != null) parts.add(_statusLabel(status));
    if (deadline != null) {
      parts.add('📅 ${_formatDate(DateTime.parse(deadline))}');
    }
    return parts.join(' · ');
  }

  String _buildProjectMeta(String? status, String? category) {
    final parts = <String>[];
    if (status != null) parts.add(_statusLabel(status));
    if (category != null) parts.add('#$category');
    return parts.join(' · ');
  }

  String _buildIdeaMeta(String? status, List<dynamic>? tags) {
    final parts = <String>[];
    if (status != null) parts.add(_statusLabel(status));
    if (tags != null && tags.isNotEmpty) {
      parts.add(tags.map((t) => '#$t').join(' '));
    }
    return parts.join(' · ');
  }

  String _statusLabel(String status) {
    return switch (status) {
      'active' => 'Activo',
      'completed' => 'Completado',
      'cancelled' => 'Cancelado',
      'in_progress' => 'En progreso',
      'pending' => 'Pendiente',
      'postponed' => 'Pospuesto',
      'paused' => 'Pausado',
      'new_idea' => 'Nueva',
      'evaluating' => 'Evaluando',
      'approved' => 'Aprobada',
      'discarded' => 'Descartada',
      'converted' => 'Convertida',
      _ => status,
    };
  }

  String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}';
  }

  void _handleEventCancel(Map<String, dynamic> data) {
    final eventId = data['event_id'] as String?;
    if (eventId == null) return;
    final notificationId = _notificationIdForEvent(eventId);
    _notifications.cancel(notificationId);
    developer.log(
      'Event notification cancelled: $eventId',
      name: 'NotificationService',
    );
  }

  String _formatTime(DateTime date) {
    return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}
