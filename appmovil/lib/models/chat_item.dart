import 'display_entity.dart';

sealed class ChatItem {
  final String id;
  final DateTime timestamp;
  ChatItem({required this.id, DateTime? timestamp})
    : timestamp = timestamp ?? DateTime.now();
}

class TextChatItem extends ChatItem {
  final String content;
  final bool isUser;
  TextChatItem({
    required super.id,
    required this.content,
    this.isUser = false,
    super.timestamp,
  });
}

class DisplayChatItem extends ChatItem {
  final List<DisplayEntity> entities;
  DisplayChatItem({required super.id, required this.entities, super.timestamp});
}

class ProcessingChatItem extends ChatItem {
  final String content;
  ProcessingChatItem({
    required super.id,
    this.content = 'Procesando...',
    super.timestamp,
  });
}
