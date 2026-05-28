import 'dart:convert';

sealed class WsMessage {
  final String version = '1';
  final String type;

  WsMessage(this.type);

  Map<String, dynamic> toJson();

  String toJsonString() => jsonEncode(toJson());
}

// ─── Client → Server ───

class AuthMessage extends WsMessage {
  final String? id;
  final String token;
  final String? audioFormat;

  AuthMessage({this.id, required this.token, this.audioFormat})
      : super('auth');

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        if (id != null) 'id': id,
        'type': type,
        'token': token,
        if (audioFormat != null) 'audio_format': audioFormat,
      };
}

class AudioChunkMessage extends WsMessage {
  final String? id;
  final String data;

  AudioChunkMessage({this.id, required this.data}) : super('audio_chunk');

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        if (id != null) 'id': id,
        'type': type,
        'data': data,
      };
}

class AudioEndMessage extends WsMessage {
  final String id;

  AudioEndMessage({required this.id}) : super('audio_end');

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'id': id,
        'type': type,
      };
}

class RegisterFcmTokenMessage extends WsMessage {
  final String? id;
  final String token;
  final String? platform;

  RegisterFcmTokenMessage({this.id, required this.token, this.platform})
      : super('register_fcm_token');

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        if (id != null) 'id': id,
        'type': type,
        'token': token,
        if (platform != null) 'platform': platform,
      };
}

// ─── Server → Client ───

class AuthOkMessage extends WsMessage {
  final String sessionId;
  final String audioFormat;
  final String? correlationId;

  AuthOkMessage({
    required this.sessionId,
    required this.audioFormat,
    this.correlationId,
  }) : super('auth_ok');

  factory AuthOkMessage.fromJson(Map<String, dynamic> json) => AuthOkMessage(
        sessionId: json['session_id'] as String,
        audioFormat: json['audio_format'] as String,
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class TextMessage extends WsMessage {
  final String content;
  final String? correlationId;

  TextMessage({required this.content, this.correlationId}) : super('text');

  factory TextMessage.fromJson(Map<String, dynamic> json) => TextMessage(
        content: json['content'] as String,
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class AudioChunkResponse extends WsMessage {
  final String data;
  final String? correlationId;

  AudioChunkResponse({required this.data, this.correlationId})
      : super('audio_chunk');

  factory AudioChunkResponse.fromJson(Map<String, dynamic> json) =>
      AudioChunkResponse(
        data: json['data'] as String,
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class AudioEndResponse extends WsMessage {
  final String? correlationId;

  AudioEndResponse({this.correlationId}) : super('audio_end');

  factory AudioEndResponse.fromJson(Map<String, dynamic> json) =>
      AudioEndResponse(
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class ActionResultMessage extends WsMessage {
  final bool ok;
  final String action;
  final String? correlationId;
  final Map<String, dynamic> payload;

  ActionResultMessage({
    required this.ok,
    required this.action,
    this.correlationId,
    required this.payload,
  }) : super('action_result');

  factory ActionResultMessage.fromJson(Map<String, dynamic> json) =>
      ActionResultMessage(
        ok: json['ok'] as bool,
        action: json['action'] as String,
        correlationId: json['correlation_id'] as String?,
        payload: json['payload'] as Map<String, dynamic>,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class NotificationMessage extends WsMessage {
  final String level;
  final String message;
  final String? correlationId;

  NotificationMessage({
    required this.level,
    required this.message,
    this.correlationId,
  }) : super('notification');

  factory NotificationMessage.fromJson(Map<String, dynamic> json) =>
      NotificationMessage(
        level: json['level'] as String,
        message: json['message'] as String,
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class ErrorMessage extends WsMessage {
  final String code;
  final String message;
  final String? correlationId;

  ErrorMessage({
    required this.code,
    required this.message,
    this.correlationId,
  }) : super('error');

  factory ErrorMessage.fromJson(Map<String, dynamic> json) => ErrorMessage(
         code: json['code'] as String,
         message: json['message'] as String,
         correlationId: json['correlation_id'] as String?,
       );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

class ProcessingMessage extends WsMessage {
  final String content;
  final String? correlationId;

  ProcessingMessage({required this.content, this.correlationId})
      : super('processing');

  factory ProcessingMessage.fromJson(Map<String, dynamic> json) =>
      ProcessingMessage(
        content: json['content'] as String,
        correlationId: json['correlation_id'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => throw UnimplementedError();
}

// ─── Parser ───

WsMessage parseServerMessage(Map<String, dynamic> json) {
  final type = json['type'] as String;
  switch (type) {
    case 'auth_ok':
      return AuthOkMessage.fromJson(json);
    case 'text':
      return TextMessage.fromJson(json);
    case 'audio_chunk':
      return AudioChunkResponse.fromJson(json);
    case 'audio_end':
      return AudioEndResponse.fromJson(json);
    case 'action_result':
      return ActionResultMessage.fromJson(json);
    case 'notification':
      return NotificationMessage.fromJson(json);
    case 'error':
      return ErrorMessage.fromJson(json);
    case 'processing':
      return ProcessingMessage.fromJson(json);
    default:
      throw FormatException('Unknown message type: $type');
  }
}
