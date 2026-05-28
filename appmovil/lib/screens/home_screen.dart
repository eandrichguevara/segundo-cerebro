import 'package:flutter/material.dart';

import '../services/audio_service.dart';
import '../services/websocket_service.dart';
import '../widgets/voice_button.dart';

class HomeScreen extends StatefulWidget {
  final WebSocketService wsService;
  final AudioService audioService;

  const HomeScreen({
    super.key,
    required this.wsService,
    required this.audioService,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  WsConnectionState _connectionState = WsConnectionState.disconnected;
  AudioServiceState _audioState = AudioServiceState.idle;
  String? _lastError;
  final List<String> _responseMessages = [];
  bool _isProcessing = false;

  @override
  void initState() {
    super.initState();
    widget.wsService.stateStream.listen((state) {
      if (mounted) {
        setState(() {
          _connectionState = state;
        });
      }
    });

    widget.audioService.stateStream.listen((state) {
      if (mounted) {
        setState(() {
          _audioState = state;
        });
        // Clear responses when starting a new recording
        if (state == AudioServiceState.recording) {
          setState(() {
            _responseMessages.clear();
          });
        }
      }
    });

    widget.wsService.errorStream.listen((error) {
      if (mounted) {
        setState(() {
          _lastError = error;
        });
        // Clear error after 5 seconds
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) {
            setState(() {
              _lastError = null;
            });
          }
        });
      }
    });

    // Listen to text responses from the server
    widget.wsService.textStream.listen((text) {
      if (mounted) {
        setState(() {
          if (text == 'Buscando...') return;
          _responseMessages.add(text);
        });
      }
    });

    // Listen to processing state
    widget.wsService.processingStream.listen((isProcessing) {
      if (mounted) {
        setState(() {
          _isProcessing = isProcessing;
        });
      }
    });

    // Listen to audio playback errors
    widget.audioService.errorStream.listen((error) {
      if (mounted) {
        setState(() {
          _lastError = error;
        });
        // Clear error after 5 seconds
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) {
            setState(() {
              _lastError = null;
            });
          }
        });
      }
    });

    // Auto-connect on start
    widget.wsService.connect();
  }

  String get _statusText {
    return switch (_connectionState) {
      WsConnectionState.disconnected => 'Desconectado',
      WsConnectionState.connecting => 'Conectando...',
      WsConnectionState.connected => 'Conectado',
      WsConnectionState.authenticating => 'Autenticando...',
      WsConnectionState.authenticated => _audioStateText,
    };
  }

  String get _audioStateText {
    return switch (_audioState) {
      AudioServiceState.idle => 'Listo',
      AudioServiceState.recording => 'Escuchando...',
      AudioServiceState.processing => 'Procesando...',
      AudioServiceState.playing => 'Hablando...',
    };
  }

  Color get _statusColor {
    return switch (_connectionState) {
      WsConnectionState.disconnected => Colors.grey,
      WsConnectionState.connecting || WsConnectionState.authenticating => Colors.orange,
      WsConnectionState.connected => Colors.blue,
      WsConnectionState.authenticated => _audioStateColor,
    };
  }

  Color get _audioStateColor {
    return switch (_audioState) {
      AudioServiceState.idle => Colors.green,
      AudioServiceState.recording => Colors.red,
      AudioServiceState.processing => Colors.orange,
      AudioServiceState.playing => Colors.green,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            // Status bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Status indicator dot with pulse animation when playing
                  _AudioIndicator(
                    color: _statusColor,
                    isPlaying: _audioState == AudioServiceState.playing,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _statusText,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            // Error banner
            if (_lastError != null)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 24),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _lastError!,
                  style: const TextStyle(
                    color: Colors.red,
                    fontSize: 14,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),

            // Main content
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          // Voice button (siempre primero y accesible)
                          VoiceButton(audioService: widget.audioService),
                          const SizedBox(height: 32),
                          // Hint text
                          Text(
                            _audioState == AudioServiceState.idle
                                ? 'Mantén presionado para hablar'
                                : '',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 32),
                          // Response messages list
                          if (_responseMessages.isNotEmpty)
                            Container(
                              margin: const EdgeInsets.symmetric(
                                horizontal: 32,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: _responseMessages.map((msg) {
                                  return Container(
                                    margin: const EdgeInsets.only(bottom: 8),
                                    padding: const EdgeInsets.all(14),
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      msg,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 16,
                                        height: 1.4,
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ),
                          // Processing indicator
                          if (_isProcessing)
                            Padding(
                              padding: EdgeInsets.only(
                                top: _responseMessages.isNotEmpty ? 4 : 32,
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white.withValues(alpha: 0.5),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Procesando...',
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.5),
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            // Reconnect button (only when disconnected)
            if (_connectionState == WsConnectionState.disconnected)
              Padding(
                padding: const EdgeInsets.all(24),
                child: ElevatedButton(
                  onPressed: widget.wsService.connect,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 16,
                    ),
                  ),
                  child: const Text('Reconectar'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Animated audio indicator that pulses when audio is playing
class _AudioIndicator extends StatefulWidget {
  final Color color;
  final bool isPlaying;

  const _AudioIndicator({
    required this.color,
    required this.isPlaying,
  });

  @override
  State<_AudioIndicator> createState() => _AudioIndicatorState();
}

class _AudioIndicatorState extends State<_AudioIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    if (widget.isPlaying) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(_AudioIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPlaying && !oldWidget.isPlaying) {
      _controller.repeat(reverse: true);
    } else if (!widget.isPlaying && oldWidget.isPlaying) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final scale = widget.isPlaying
            ? 1.0 + (_controller.value * 0.5)
            : 1.0;
        final opacity = widget.isPlaying
            ? 0.6 + (_controller.value * 0.4)
            : 1.0;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: widget.color.withValues(alpha: opacity),
            ),
          ),
        );
      },
    );
  }
}
