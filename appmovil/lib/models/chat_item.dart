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
    required String id,
    required this.content,
    this.isUser = false,
    DateTime? timestamp,
  }) : super(id: id, timestamp: timestamp);
}

class DisplayChatItem extends ChatItem {
  final List<DisplayEntity> entities;
  DisplayChatItem(
      {required String id, required this.entities, DateTime? timestamp})
      : super(id: id, timestamp: timestamp);
}

class ProcessingChatItem extends ChatItem {
  final String content;
  ProcessingChatItem(
      {required String id, this.content = 'Procesando...', DateTime? timestamp})
      : super(id: id, timestamp: timestamp);
}
