import 'dart:async';
import 'dart:convert';
import 'dart:developer';

import 'package:record/record.dart';
import 'package:uuid/uuid.dart';

import '../models/ws_message.dart';
import 'websocket_service.dart';

enum AudioServiceState {
  idle,
  recording,
  processing,
  playing,
}

class AudioService {
  final WebSocketService _wsService;
  final _audioRecorder = AudioRecorder();

  final _stateController = StreamController<AudioServiceState>.broadcast();
  Stream<AudioServiceState> get stateStream => _stateController.stream;

  final _errorController = StreamController<String>.broadcast();
  Stream<String> get errorStream => _errorController.stream;

  AudioServiceState _state = AudioServiceState.idle;
  AudioServiceState get state => _state;

  bool _isRecording = false;
  String? _currentCorrelationId;
  Timer? _processingTimeout;

  AudioService(this._wsService) {
    _wsService.messageStream.listen(_onMessage);
  }

  Future<void> initialize() async {}

  Future<void> startRecording() async {
    if (_isRecording || _state == AudioServiceState.processing) return;

    _isRecording = true;
    _setState(AudioServiceState.recording);
    _currentCorrelationId = const Uuid().v4();

    final hasPermission = await _audioRecorder.hasPermission();
    if (!hasPermission) {
      _isRecording = false;
      _setState(AudioServiceState.idle);
      throw Exception('Microphone permission denied');
    }

    if (!_isRecording) return;

    final stream = await _audioRecorder.startStream(
      const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
      ),
    );

    stream.listen(
      (data) {
        if (!_isRecording) return;
        final base64Data = base64Encode(data);
        _wsService.sendMessage(
          AudioChunkMessage(data: base64Data),
        );
      },
      onError: (e) {
        _isRecording = false;
        _setState(AudioServiceState.idle);
      },
    );
  }

  Future<void> stopRecording() async {
    if (!_isRecording) return;

    _isRecording = false;
    await _audioRecorder.stop();

    _setState(AudioServiceState.processing);

    _processingTimeout?.cancel();
    _processingTimeout = Timer(const Duration(seconds: 30), () {
      if (_state == AudioServiceState.processing) {
        log('Processing timeout — resetting to idle');
        _setState(AudioServiceState.idle);
      }
    });

    if (_currentCorrelationId != null) {
      _wsService.sendMessage(
        AudioEndMessage(id: _currentCorrelationId!),
      );
    }
  }

  void _onMessage(WsMessage message) {
    if (message is AudioEndResponse) {
      _processingTimeout?.cancel();
      _processingTimeout = null;
      _setState(AudioServiceState.idle);
    } else if (message is ErrorMessage) {
      log('Received error from server: ${message.code}: ${message.message}');
      _processingTimeout?.cancel();
      _processingTimeout = null;
      _setState(AudioServiceState.idle);
    } else if (message is ProcessingMessage) {
      _setState(AudioServiceState.processing);
    }
  }

  void _setState(AudioServiceState state) {
    _state = state;
    _stateController.add(state);
    if (state != AudioServiceState.processing) {
      _processingTimeout?.cancel();
      _processingTimeout = null;
    }
  }

  Future<void> dispose() async {
    _processingTimeout?.cancel();
    if (_isRecording) {
      await _audioRecorder.stop();
    }
    await _audioRecorder.dispose();
    _stateController.close();
    _errorController.close();
  }
}
