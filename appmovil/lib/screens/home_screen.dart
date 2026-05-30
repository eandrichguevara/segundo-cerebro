import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../models/chat_item.dart';
import '../models/display_entity.dart';
import '../services/audio_service.dart';
import '../services/websocket_service.dart';
import '../widgets/display_cards.dart';

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

class _HomeScreenState extends State<HomeScreen> {
  WsConnectionState _connectionState = WsConnectionState.disconnected;
  AudioServiceState _audioState = AudioServiceState.idle;
  String? _lastError;
  final List<ChatItem> _history = [];
  bool _isProcessing = false;
  final _scrollController = ScrollController();
  final _uuid = const Uuid();
  bool _historyLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadHistory();

    widget.wsService.stateStream.listen((state) {
      if (mounted) {
        setState(() => _connectionState = state);
      }
    });

    widget.audioService.stateStream.listen((state) {
      if (mounted) {
        setState(() => _audioState = state);
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
        setState(() {
          _history.add(TextChatItem(
            id: _uuid.v4(),
            content: text,
            isUser: true,
          ));
          _trimHistory();
        });
        _saveHistory();
        _scrollToBottom();
      }
    });

    widget.wsService.textStream.listen((text) {
      if (mounted) {
        if (text == 'Buscando...') return;
        setState(() {
          _history.add(TextChatItem(
            id: _uuid.v4(),
            content: text,
            isUser: false,
          ));
          _trimHistory();
        });
        _saveHistory();
        _scrollToBottom();
      }
    });

    widget.wsService.displayStream.listen((entities) {
      if (mounted && entities.isNotEmpty) {
        setState(() {
          _history.add(DisplayChatItem(id: _uuid.v4(), entities: entities));
          _trimHistory();
        });
        _saveHistory();
        _scrollToBottom();
      }
    });

    widget.wsService.processingStream.listen((isProcessing) {
      if (mounted) {
        setState(() => _isProcessing = isProcessing);
        if (!isProcessing) _scrollToBottom();
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

    widget.wsService.connect();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_kHistoryKey);
    if (json != null) {
      try {
        final list = jsonDecode(json) as List<dynamic>;
        final items = list
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
    if (_history.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final json =
        jsonEncode(_history.map((e) => _chatItemToJson(e)).toList());
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
      final ts = json['timestamp'] != null
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
            entities: (json['entities'] as List<dynamic>)
                .map((e) =>
                    DisplayEntity.fromJson(e as Map<String, dynamic>))
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
    setState(() => _history.clear());
    SharedPreferences.getInstance()
        .then((prefs) => prefs.remove(_kHistoryKey));
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
      AudioServiceState.idle => 'Tocá para hablar',
      AudioServiceState.recording => 'Escuchando...',
      AudioServiceState.processing => 'Procesando...',
      AudioServiceState.playing => 'Hablando...',
    };
  }

  Color get _statusColor {
    return switch (_connectionState) {
      WsConnectionState.disconnected => Colors.grey,
      WsConnectionState.connecting || WsConnectionState.authenticating =>
        Colors.orange,
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
            _statusText,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.7),
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const Spacer(),
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
          child: CircularProgressIndicator(color: Colors.white24));
    }

    if (_history.isEmpty && !_isProcessing) {
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
      itemCount: _history.length + (_isProcessing ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == _history.length && _isProcessing) {
          return _buildProcessingIndicator();
        }
        return _buildChatItem(_history[index]);
      },
    );
  }

  Widget _buildChatItem(ChatItem item) {
    return Padding(
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
          color: isUser ? _userBubbleColor : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: isUser
                ? const Radius.circular(18)
                : const Radius.circular(4),
            bottomRight: isUser
                ? const Radius.circular(4)
                : const Radius.circular(18),
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
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.white38,
            ),
          ),
          SizedBox(width: 8),
          Text(
            'Escribiendo...',
            style: TextStyle(
              color: Colors.white38,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    final color = _connectionState == WsConnectionState.authenticated
        ? _audioState == AudioServiceState.recording
            ? Colors.red
            : _userBubbleColor
        : Colors.grey;

    final isActive = _connectionState == WsConnectionState.authenticated &&
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
          GestureDetector(
            onTap: isActive
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
                ],
              ),
              child: Icon(
                _audioState == AudioServiceState.recording
                    ? Icons.stop
                    : Icons.mic,
                color: Colors.white,
                size: 28,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
