import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:segundo_cerebro/models/ws_message.dart';
import 'package:segundo_cerebro/services/websocket_service.dart';

void main() {
  group('WS Message Models', () {
    test('AuthMessage serializes correctly', () {
      final msg = AuthMessage(
        id: 'test-uuid',
        token: 'my-token',
        audioFormat: 'mp3',
      );

      final json = jsonDecode(msg.toJsonString()) as Map<String, dynamic>;
      expect(json['version'], '1');
      expect(json['type'], 'auth');
      expect(json['id'], 'test-uuid');
      expect(json['token'], 'my-token');
      expect(json['audio_format'], 'mp3');
    });

    test('AudioChunkMessage serializes correctly', () {
      final msg = AudioChunkMessage(data: 'base64data');
      final json = jsonDecode(msg.toJsonString()) as Map<String, dynamic>;
      expect(json['version'], '1');
      expect(json['type'], 'audio_chunk');
      expect(json['data'], 'base64data');
    });

    test('AudioEndMessage serializes correctly', () {
      final msg = AudioEndMessage(id: 'test-id');
      final json = jsonDecode(msg.toJsonString()) as Map<String, dynamic>;
      expect(json['version'], '1');
      expect(json['type'], 'audio_end');
      expect(json['id'], 'test-id');
    });

    test('StartInterviewMessage serializes correctly', () {
      final msg = StartInterviewMessage(id: 'interview-uuid');
      final json = jsonDecode(msg.toJsonString()) as Map<String, dynamic>;
      expect(json['version'], '1');
      expect(json['type'], 'start_interview');
      expect(json['id'], 'interview-uuid');
    });

    test('StopInterviewMessage serializes correctly', () {
      final msg = StopInterviewMessage(id: 'stop-uuid');
      final json = jsonDecode(msg.toJsonString()) as Map<String, dynamic>;
      expect(json['version'], '1');
      expect(json['type'], 'stop_interview');
      expect(json['id'], 'stop-uuid');
    });

    test('InterviewStartedMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'interview_started',
        'correlation_id': 'corr-int',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<InterviewStartedMessage>());
      final intMsg = msg as InterviewStartedMessage;
      expect(intMsg.correlationId, 'corr-int');
    });

    test('InterviewEndedMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'interview_ended',
        'summary': {
          'questions_asked': 5,
          'areas_covered': ['Horarios', 'Preferencias'],
          'entities_created': 2,
        },
        'correlation_id': 'corr-end',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<InterviewEndedMessage>());
      final endMsg = msg as InterviewEndedMessage;
      expect(endMsg.summary.questionsAsked, 5);
      expect(endMsg.summary.areasCovered, ['Horarios', 'Preferencias']);
      expect(endMsg.summary.entitiesCreated, 2);
    });

    test('AuthOkMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'auth_ok',
        'session_id': 'sess-123',
        'audio_format': 'mp3',
        'correlation_id': 'corr-456',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<AuthOkMessage>());
      final authOk = msg as AuthOkMessage;
      expect(authOk.sessionId, 'sess-123');
      expect(authOk.audioFormat, 'mp3');
      expect(authOk.correlationId, 'corr-456');
    });

    test('TextMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'text',
        'content': 'Hello world',
        'correlation_id': 'corr-789',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<TextMessage>());
      final textMsg = msg as TextMessage;
      expect(textMsg.content, 'Hello world');
      expect(textMsg.correlationId, 'corr-789');
    });

    test('ErrorMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'error',
        'code': 'AUTH_FAILED',
        'message': 'Invalid token',
        'correlation_id': 'corr-999',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<ErrorMessage>());
      final errorMsg = msg as ErrorMessage;
      expect(errorMsg.code, 'AUTH_FAILED');
      expect(errorMsg.message, 'Invalid token');
      expect(errorMsg.correlationId, 'corr-999');
    });

    test('ActionResultMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'action_result',
        'ok': true,
        'action': 'create_task',
        'correlation_id': 'corr-111',
        'payload': {'id': 'task-1', 'title': 'Test task'},
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<ActionResultMessage>());
      final actionMsg = msg as ActionResultMessage;
      expect(actionMsg.ok, true);
      expect(actionMsg.action, 'create_task');
      expect(actionMsg.payload['id'], 'task-1');
    });

    test('NotificationMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'notification',
        'level': 'reminder',
        'message': 'Time to work',
        'correlation_id': 'corr-222',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<NotificationMessage>());
      final notifMsg = msg as NotificationMessage;
      expect(notifMsg.level, 'reminder');
      expect(notifMsg.message, 'Time to work');
    });

    test('ProcessingMessage deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'processing',
        'content': 'Buscando...',
        'correlation_id': 'corr-555',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<ProcessingMessage>());
      final processingMsg = msg as ProcessingMessage;
      expect(processingMsg.content, 'Buscando...');
      expect(processingMsg.correlationId, 'corr-555');
    });

    test('AudioChunkResponse deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'audio_chunk',
        'data': 'base64audiodata',
        'correlation_id': 'corr-333',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<AudioChunkResponse>());
      final audioMsg = msg as AudioChunkResponse;
      expect(audioMsg.data, 'base64audiodata');
    });

    test('AudioEndResponse deserializes correctly', () {
      final json = {
        'version': '1',
        'type': 'audio_end',
        'correlation_id': 'corr-444',
      };

      final msg = parseServerMessage(json);
      expect(msg, isA<AudioEndResponse>());
      final endMsg = msg as AudioEndResponse;
      expect(endMsg.correlationId, 'corr-444');
    });

    test('throws on unknown message type', () {
      final json = {'version': '1', 'type': 'unknown_type'};

      expect(() => parseServerMessage(json), throwsFormatException);
    });
  });

  group('WebSocket Service', () {
    test('initial state is disconnected', () {
      final service = WebSocketService();
      expect(service.state, WsConnectionState.disconnected);
      service.dispose();
    });

    test('state stream emits states on state change', () async {
      final service = WebSocketService();
      final states = <WsConnectionState>[];

      final subscription = service.stateStream.listen(states.add);

      // Trigger a state change by attempting to connect to an invalid URL
      // This will transition from disconnected -> connecting
      service.connect();
      await Future.delayed(const Duration(milliseconds: 100));
      expect(states, contains(WsConnectionState.connecting));

      subscription.cancel();
      service.dispose();
    });
  });

  group('Smoke Test - End to End Message Flow', () {
    test('complete message roundtrip', () {
      // Simulate client sending auth and receiving auth_ok
      final authRequest = AuthMessage(
        id: 'auth-id-1',
        token: 'test-token',
        audioFormat: 'mp3',
      );

      // Verify request serialization
      final authJson =
          jsonDecode(authRequest.toJsonString()) as Map<String, dynamic>;
      expect(authJson['type'], 'auth');
      expect(authJson['token'], 'test-token');

      // Simulate server response
      final authResponse = AuthOkMessage(
        sessionId: 'sess-abc',
        audioFormat: 'mp3',
        correlationId: 'auth-id-1',
      );

      expect(authResponse.sessionId, 'sess-abc');
      expect(authResponse.type, 'auth_ok');

      // Simulate audio chunk
      final audioChunk = AudioChunkMessage(
        data: base64Encode(Uint8List.fromList([1, 2, 3, 4])),
      );
      final chunkJson =
          jsonDecode(audioChunk.toJsonString()) as Map<String, dynamic>;
      expect(chunkJson['type'], 'audio_chunk');
      expect(chunkJson['data'], isNotEmpty);

      // Simulate audio end
      final audioEnd = AudioEndMessage(id: 'audio-id-1');
      final endJson =
          jsonDecode(audioEnd.toJsonString()) as Map<String, dynamic>;
      expect(endJson['type'], 'audio_end');
      expect(endJson['id'], 'audio-id-1');
    });
  });
}
