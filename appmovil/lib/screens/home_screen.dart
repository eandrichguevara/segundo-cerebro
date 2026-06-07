import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../config/version.dart';
import '../models/chat_item.dart';
import '../models/display_entity.dart';
import '../models/ws_message.dart';
import '../services/audio_service.dart';
import '../services/websocket_service.dart';
import '../widgets/display_cards.dart';
import '../widgets/interview_button.dart';

const _kHistoryKey = 'chat_history';
const _kMaxHistoryItems = 200;
const _userBubbleColor = Color(0xFF7C4DFF);

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

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  WsConnectionState _connectionState = WsConnectionState.disconnected;
  AudioServiceState _audioState = AudioServiceState.idle;
  String? _lastError;
  final List<ChatItem> _history = [];
  bool _isInterviewMode = false;

  final _scrollController = ScrollController();
  final _uuid = const Uuid();
  bool _historyLoaded = false;
  final List<ChatItem> _messageQueue = [];
  bool _isAnimatingMessage = false;
  String? _typingIndicatorId;
  late AnimationController _thinkingController;

  @override
  void initState() {
    super.initState();
    _thinkingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _loadHistory();

    widget.wsService.stateStream.listen((state) {
      if (mounted) {
        setState(() => _connectionState = state);
      }
    });

    widget.audioService.stateStream.listen((state) {
      if (mounted) {
        setState(() {
          _audioState = state;
          if (state == AudioServiceState.recording) {
            _cancelQueue();
          }
          if (state == AudioServiceState.processing) {
            if (!_thinkingController.isAnimating) {
              _thinkingController.repeat(reverse: true);
            }
            _showTyping();
          } else {
            if (_thinkingController.isAnimating) {
              _thinkingController.stop();
              _thinkingController.reset();
            }
          }
        });
      }
    });

    widget.wsService.errorStream.listen((error) {
      if (mounted) {
        setState(() => _lastError = error);
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) setState(() => _lastError = null);
        });
      }
    });

    widget.wsService.transcriptionStream.listen((text) {
      if (mounted) {
        _hideTyping();
        setState(() {
          _history.add(
            TextChatItem(id: _uuid.v4(), content: text, isUser: true),
          );
          _trimHistory();
        });
        _saveHistory();
        _scrollToBottom();
      }
    });

    widget.wsService.textStream.listen((text) {
      if (mounted) {
        if (text == 'Buscando...') return;
        _enqueueMessage(
          TextChatItem(id: _uuid.v4(), content: text, isUser: false),
        );
      }
    });

    widget.wsService.displayStream.listen((entities) {
      if (mounted && entities.isNotEmpty) {
        _enqueueMessage(DisplayChatItem(id: _uuid.v4(), entities: entities));
      }
    });

    widget.wsService.processingStream.listen((isProcessing) {
      if (mounted) {
        if (isProcessing) {
          _showTyping();
        } else {
          _hideTyping();
        }
      }
    });

    widget.audioService.errorStream.listen((error) {
      if (mounted) {
        setState(() => _lastError = error);
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) setState(() => _lastError = null);
        });
      }
    });

    widget.wsService.interviewStartedStream.listen((_) {
      if (mounted) {
        setState(() => _isInterviewMode = true);
      }
    });

    widget.wsService.interviewEndedStream.listen((summary) {
      if (mounted) {
        setState(() => _isInterviewMode = false);
        if (summary.questionsAsked > 0) {
          _enqueueMessage(
            TextChatItem(
              id: _uuid.v4(),
              content:
                  '📊 Resumen: ${summary.questionsAsked} preguntas, ${summary.areasCovered.length} áreas cubiertas, ${summary.entitiesCreated} entidades creadas.',
              isUser: false,
            ),
          );
        }
      }
    });

    widget.wsService.connect();
  }

  @override
  void dispose() {
    _thinkingController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_kHistoryKey);
    if (json != null) {
      try {
        final list = jsonDecode(json) as List<dynamic>;
        final items =
            list
                .map((e) => _chatItemFromJson(e as Map<String, dynamic>))
                .whereType<ChatItem>()
                .toList();
        if (mounted) {
          setState(() {
            _history.addAll(items);
            _historyLoaded = true;
          });
        }
      } catch (_) {}
    } else {
      if (mounted) setState(() => _historyLoaded = true);
    }
  }

  Future<void> _saveHistory() async {
    final items = _history.where((e) => e is! ProcessingChatItem).toList();
    if (items.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final json = jsonEncode(items.map((e) => _chatItemToJson(e)).toList());
    await prefs.setString(_kHistoryKey, json);
  }

  Map<String, dynamic> _chatItemToJson(ChatItem item) {
    return switch (item) {
      TextChatItem i => {
        'type': 'text',
        'id': i.id,
        'content': i.content,
        'isUser': i.isUser,
        'timestamp': i.timestamp.toIso8601String(),
      },
      DisplayChatItem i => {
        'type': 'display',
        'id': i.id,
        'entities': i.entities.map((e) => e.toJson()).toList(),
        'timestamp': i.timestamp.toIso8601String(),
      },
      ProcessingChatItem i => {
        'type': 'processing',
        'id': i.id,
        'content': i.content,
        'timestamp': i.timestamp.toIso8601String(),
      },
    };
  }

  ChatItem? _chatItemFromJson(Map<String, dynamic> json) {
    try {
      final id = json['id'] as String;
      final ts =
          json['timestamp'] != null
              ? DateTime.parse(json['timestamp'] as String)
              : null;
      return switch (json['type'] as String) {
        'text' => TextChatItem(
          id: id,
          content: json['content'] as String,
          isUser: json['isUser'] as bool? ?? false,
          timestamp: ts,
        ),
        'display' => DisplayChatItem(
          id: id,
          entities:
              (json['entities'] as List<dynamic>)
                  .map((e) => DisplayEntity.fromJson(e as Map<String, dynamic>))
                  .toList(),
          timestamp: ts,
        ),
        _ => null,
      };
    } catch (_) {
      return null;
    }
  }

  void _trimHistory() {
    while (_history.length > _kMaxHistoryItems) {
      _history.removeAt(0);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _clearHistory() {
    _cancelQueue();
    setState(() => _history.clear());
    SharedPreferences.getInstance().then((prefs) => prefs.remove(_kHistoryKey));
  }

  void _cancelQueue() {
    _messageQueue.clear();
    _isAnimatingMessage = false;
    _hideTyping();
  }

  void _showTyping() {
    if (_typingIndicatorId != null) return;
    final id = _uuid.v4();
    _typingIndicatorId = id;
    setState(() {
      _history.add(ProcessingChatItem(id: id));
      _trimHistory();
    });
    _scrollToBottom();
  }

  void _hideTyping() {
    if (_typingIndicatorId == null) return;
    final id = _typingIndicatorId!;
    _typingIndicatorId = null;
    setState(() {
      _history.removeWhere((h) => h.id == id);
    });
  }

  void _enqueueMessage(ChatItem item) {
    _messageQueue.add(item);
    if (!_isAnimatingMessage) {
      _processQueue();
    }
  }

  Future<void> _processQueue() async {
    if (_messageQueue.isEmpty) {
      _isAnimatingMessage = false;
      if (_audioState == AudioServiceState.processing) _showTyping();
      return;
    }

    _isAnimatingMessage = true;

    _hideTyping();

    final typingId = _uuid.v4();
    setState(() {
      _typingIndicatorId = typingId;
      _history.add(ProcessingChatItem(id: typingId));
      _trimHistory();
    });
    _scrollToBottom();

    await Future.delayed(const Duration(milliseconds: 1500));

    if (_messageQueue.isEmpty) {
      _hideTyping();
      _isAnimatingMessage = false;
      if (_audioState == AudioServiceState.processing) _showTyping();
      return;
    }

    final message = _messageQueue.removeAt(0);
    _hideTyping();
    setState(() {
      _history.add(message);
      _trimHistory();
    });
    _saveHistory();
    _scrollToBottom();

    await Future.delayed(const Duration(milliseconds: 400));

    _processQueue();
  }

  String get _statusText {
    return switch (_connectionState) {
      WsConnectionState.disconnected => 'Desconectado',
      WsConnectionState.connecting ||
      WsConnectionState.connected ||
      WsConnectionState.authenticating => 'Conectando...',
      WsConnectionState.authenticated => 'Conectado',
    };
  }

  Color get _statusColor {
    return switch (_connectionState) {
      WsConnectionState.disconnected => Colors.grey,
      WsConnectionState.connecting ||
      WsConnectionState.connected ||
      WsConnectionState.authenticating => Colors.orange,
      WsConnectionState.authenticated => Colors.green,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            _buildStatusBar(),
            if (_lastError != null) _buildErrorBanner(),
            Expanded(child: _buildChatList()),
            _buildBottomBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _statusColor,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _isInterviewMode ? 'Modo preguntas' : _statusText,
            style: TextStyle(
              color:
                  _isInterviewMode
                      ? const Color(0xFF00BCD4)
                      : Colors.white.withValues(alpha: 0.7),
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const Spacer(),
          Text(
            "v$appVersion+$buildNumber",
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.25),
              fontSize: 11,
            ),
          ),
          if (_history.isNotEmpty) const SizedBox(width: 8),
          if (_history.isNotEmpty)
            GestureDetector(
              onTap: _clearHistory,
              child: Icon(
                Icons.delete_outline,
                color: Colors.white.withValues(alpha: 0.35),
                size: 18,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Colors.red, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _lastError!,
              style: const TextStyle(color: Colors.red, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChatList() {
    if (!_historyLoaded) {
      return const Center(
        child: CircularProgressIndicator(color: Colors.white24),
      );
    }

    if (_history.isEmpty) {
      return Center(
        child: Text(
          'Tocá para hablar',
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.35),
            fontSize: 15,
          ),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: _history.length,
      itemBuilder: (context, index) {
        return _buildChatItem(_history[index]);
      },
    );
  }

  Widget _buildChatItem(ChatItem item) {
    final isUser = item is TextChatItem ? item.isUser : false;
    final slideX = isUser ? 30.0 : -30.0;

    return TweenAnimationBuilder<double>(
      key: ValueKey(item.id),
      tween: Tween(begin: 0.0, end: 1.0),
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(slideX * (1 - value), 0),
            child: child,
          ),
        );
      },
      child: Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: switch (item) {
          TextChatItem i => _buildTextBubble(i.content, i.isUser),
          DisplayChatItem i => Align(
            alignment: Alignment.centerLeft,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children:
                  i.entities.map((e) => DisplayEntityCard(entity: e)).toList(),
            ),
          ),
          ProcessingChatItem _ => _buildProcessingIndicator(),
        },
      ),
    );
  }

  Widget _buildTextBubble(String text, bool isUser) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.8,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color:
              isUser ? _userBubbleColor : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft:
                isUser ? const Radius.circular(18) : const Radius.circular(4),
            bottomRight:
                isUser ? const Radius.circular(4) : const Radius.circular(18),
          ),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: isUser ? Colors.white : Colors.white.withValues(alpha: 0.9),
            fontSize: 15,
            height: 1.35,
          ),
        ),
      ),
    );
  }

  Widget _buildProcessingIndicator() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.8,
        ),
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.08),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.zero,
            topRight: Radius.circular(16),
            bottomLeft: Radius.circular(16),
            bottomRight: Radius.circular(16),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Escuchando...',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.6),
                fontSize: 14,
              ),
            ),
            const SizedBox(width: 4),
            const _AnimatedTypingDots(),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomBar() {
    final color =
        _connectionState == WsConnectionState.authenticated
            ? _audioState == AudioServiceState.recording
                ? Colors.red
                : _userBubbleColor
            : Colors.grey;

    final isActive =
        _connectionState == WsConnectionState.authenticated &&
        _audioState == AudioServiceState.idle;

    final isInterviewEnabled =
        _connectionState == WsConnectionState.authenticated &&
        _audioState == AudioServiceState.idle;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          InterviewButton(
            isActive: _isInterviewMode,
            isEnabled: isInterviewEnabled,
            onTap: () {
              if (_isInterviewMode) {
                widget.wsService.sendMessage(
                  StopInterviewMessage(id: _uuid.v4()),
                );
              } else if (!_isInterviewMode) {
                // Guard contra taps rápidos: si el estado ya cambió entre
                // la lectura de _isInterviewMode y este momento, no enviamos
                widget.wsService.sendMessage(
                  StartInterviewMessage(id: _uuid.v4()),
                );
              }
            },
          ),
          const SizedBox(width: 24),
          GestureDetector(
            onTap:
                isActive
                    ? () => widget.audioService.startRecording()
                    : (_audioState == AudioServiceState.recording
                        ? () => widget.audioService.stopRecording()
                        : null),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color,
                boxShadow: [
                  if (_audioState == AudioServiceState.recording)
                    BoxShadow(
                      color: Colors.red.withValues(alpha: 0.4),
                      blurRadius: 16,
                      spreadRadius: 2,
                    ),
                  if (_audioState == AudioServiceState.processing)
                    BoxShadow(
                      color: _userBubbleColor.withValues(alpha: 0.3),
                      blurRadius: 14,
                      spreadRadius: 1,
                    ),
                ],
              ),
              child: switch (_audioState) {
                AudioServiceState.recording => const Icon(
                  Icons.stop,
                  color: Colors.white,
                  size: 28,
                ),
                AudioServiceState.processing => AnimatedBuilder(
                  animation: _thinkingController,
                  builder: (context, _) {
                    final scale = 1.0 + (_thinkingController.value * 0.08);
                    return Transform.scale(
                      scale: scale,
                      child: const Icon(
                        Icons.auto_awesome,
                        color: Colors.white,
                        size: 28,
                      ),
                    );
                  },
                ),
                _ => const Icon(Icons.mic, color: Colors.white, size: 28),
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _AnimatedTypingDots extends StatefulWidget {
  const _AnimatedTypingDots();

  @override
  State<_AnimatedTypingDots> createState() => _AnimatedTypingDotsState();
}

class _AnimatedTypingDotsState extends State<_AnimatedTypingDots>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
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
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (index) {
            final delay = index * 0.2;
            final t = (_controller.value - delay).clamp(0.0, 1.0);
            final opacity = (t < 0.5 ? t * 2 : 2 - t * 2).clamp(0.3, 1.0);
            return Padding(
              padding: EdgeInsets.only(right: index < 2 ? 2 : 0),
              child: Text(
                '•',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.6 * opacity),
                  fontSize: 16,
                ),
              ),
            );
          }),
        );
      },
    );
  }
}
