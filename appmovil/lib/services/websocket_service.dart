import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../config/app_config.dart';
import '../models/ws_message.dart';

enum WsConnectionState {
  disconnected,
  connecting,
  connected,
  authenticating,
  authenticated,
}

class WebSocketService {
  WebSocketChannel? _channel;
  final _stateController = StreamController<WsConnectionState>.broadcast();
  final _messageController = StreamController<WsMessage>.broadcast();
  final _textController = StreamController<String>.broadcast();
  final _errorController = StreamController<String>.broadcast();
  final _processingController = StreamController<bool>.broadcast();

  Stream<WsConnectionState> get stateStream => _stateController.stream;
  Stream<WsMessage> get messageStream => _messageController.stream;
  Stream<String> get textStream => _textController.stream;
  Stream<String> get errorStream => _errorController.stream;
  Stream<bool> get processingStream => _processingController.stream;

  WsConnectionState _state = WsConnectionState.disconnected;
  WsConnectionState get state => _state;

  bool _shouldReconnect = true;
  int _reconnectAttempts = 0;
  static const _maxReconnectDelayMs = 30000;

  Timer? _reconnectTimer;

  void connect() {
    if (_state == WsConnectionState.connected ||
        _state == WsConnectionState.authenticating ||
        _state == WsConnectionState.authenticated) {
      return;
    }

    _setState(WsConnectionState.connecting);
    _shouldReconnect = true;

    try {
      final wsUri = Uri.parse(AppConfig.wsUrl);
      _channel = WebSocketChannel.connect(wsUri);

      _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDisconnected,
        cancelOnError: false,
      );

      _setState(WsConnectionState.connected);
      _authenticate();
    } catch (e) {
      _errorController.add('Connection failed: $e');
      _scheduleReconnect();
    }
  }

  void _authenticate() {
    _setState(WsConnectionState.authenticating);
    sendMessage(
      AuthMessage(
        token: AppConfig.authToken,
        audioFormat: 'mp3',
      ),
    );
  }

  void _onMessage(dynamic message) {
    try {
      final json = jsonDecode(message as String) as Map<String, dynamic>;
      final wsMessage = parseServerMessage(json);
      _messageController.add(wsMessage);
      _handleMessage(wsMessage);
    } catch (e) {
      _errorController.add('Failed to parse message: $e');
    }
  }

  void _handleMessage(WsMessage message) {
    switch (message) {
      case AuthOkMessage():
        _setState(WsConnectionState.authenticated);
        _reconnectAttempts = 0;
        break;
      case TextMessage msg:
        _textController.add(msg.content);
        break;
      case ProcessingMessage msg:
        _textController.add(msg.content);
        _processingController.add(true);
        break;
      case AudioChunkResponse():
        break;
      case AudioEndResponse():
        _processingController.add(false);
        break;
      case ActionResultMessage():
        break;
      case NotificationMessage msg:
        _textController.add('[${msg.level}] ${msg.message}');
        break;
      case ErrorMessage msg:
        _errorController.add('${msg.code}: ${msg.message}');
        if (msg.code == 'AUTH_FAILED') {
          _shouldReconnect = false;
          disconnect();
        }
        break;
      case AuthMessage():
      case AudioChunkMessage():
      case AudioEndMessage():
      case RegisterFcmTokenMessage():
        break;
    }
  }

  void _onError(Object error) {
    _errorController.add('WebSocket error: $error');
    _scheduleReconnect();
  }

  void _onDisconnected() {
    if (_state != WsConnectionState.disconnected) {
      _setState(WsConnectionState.disconnected);
      _channel = null;
      if (_shouldReconnect) {
        _scheduleReconnect();
      }
    }
  }

  void _scheduleReconnect() {
    if (!_shouldReconnect || _reconnectTimer != null) return;

    final delayMs = min(
      1000 * pow(2, _reconnectAttempts).toInt(),
      _maxReconnectDelayMs,
    );
    _reconnectAttempts++;

    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      _reconnectTimer = null;
      connect();
    });
  }

  void sendMessage(WsMessage message) {
    if (_channel != null && _channel!.closeCode == null) {
      _channel!.sink.add(message.toJsonString());
    }
  }

  void disconnect() {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _channel?.sink.close();
    _channel = null;
    _setState(WsConnectionState.disconnected);
  }

  void _setState(WsConnectionState state) {
    _state = state;
    _stateController.add(state);
  }

  void dispose() {
    disconnect();
    _stateController.close();
    _messageController.close();
    _textController.close();
    _errorController.close();
    _processingController.close();
  }
}
