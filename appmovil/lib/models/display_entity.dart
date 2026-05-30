sealed class DisplayEntity {
  final String type;
  DisplayEntity(this.type);

  factory DisplayEntity.fromJson(Map<String, dynamic> json) {
    return switch (json['type'] as String) {
      'task' => TaskDisplay.fromJson(json),
      'list' => ListDisplay.fromJson(json),
      'objective' => ObjectiveDisplay.fromJson(json),
      'event' => EventDisplay.fromJson(json),
      'memory' => MemoryDisplay.fromJson(json),
      _ => throw FormatException('Unknown display type: ${json['type']}'),
    };
  }

  Map<String, dynamic> toJson();
}

class TaskDisplay extends DisplayEntity {
  final String title;
  final String priority;
  final String status;
  final String? dueDate;

  TaskDisplay({
    required this.title,
    required this.priority,
    required this.status,
    this.dueDate,
  }) : super('task');

  factory TaskDisplay.fromJson(Map<String, dynamic> json) => TaskDisplay(
        title: json['title'] as String,
        priority: json['priority'] as String,
        status: json['status'] as String,
        dueDate: json['dueDate'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'title': title,
        'priority': priority,
        'status': status,
        if (dueDate != null) 'dueDate': dueDate,
      };
}

class ListDisplay extends DisplayEntity {
  final String title;
  final List<ListItem> items;

  ListDisplay({required this.title, required this.items}) : super('list');

  factory ListDisplay.fromJson(Map<String, dynamic> json) => ListDisplay(
        title: json['title'] as String,
        items: (json['items'] as List<dynamic>)
            .map((e) => ListItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'title': title,
        'items': items.map((e) => e.toJson()).toList(),
      };
}

class ListItem {
  final String content;
  final String? quantity;
  final bool checked;

  ListItem({required this.content, this.quantity, required this.checked});

  factory ListItem.fromJson(Map<String, dynamic> json) => ListItem(
        content: json['content'] as String,
        quantity: json['quantity'] as String?,
        checked: json['checked'] as bool,
      );

  Map<String, dynamic> toJson() => {
        'content': content,
        if (quantity != null) 'quantity': quantity,
        'checked': checked,
      };
}

class ObjectiveDisplay extends DisplayEntity {
  final String title;
  final String status;
  final String? deadline;

  ObjectiveDisplay({
    required this.title,
    required this.status,
    this.deadline,
  }) : super('objective');

  factory ObjectiveDisplay.fromJson(Map<String, dynamic> json) =>
      ObjectiveDisplay(
        title: json['title'] as String,
        status: json['status'] as String,
        deadline: json['deadline'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'title': title,
        'status': status,
        if (deadline != null) 'deadline': deadline,
      };
}

class EventDisplay extends DisplayEntity {
  final String title;
  final String startTime;
  final String? endTime;
  final String? location;
  final String? recurrence;
  final String? category;

  EventDisplay({
    required this.title,
    required this.startTime,
    this.endTime,
    this.location,
    this.recurrence,
    this.category,
  }) : super('event');

  factory EventDisplay.fromJson(Map<String, dynamic> json) => EventDisplay(
        title: json['title'] as String,
        startTime: json['startTime'] as String,
        endTime: json['endTime'] as String?,
        location: json['location'] as String?,
        recurrence: json['recurrence'] as String?,
        category: json['category'] as String?,
      );

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'title': title,
        'startTime': startTime,
        if (endTime != null) 'endTime': endTime,
        if (location != null) 'location': location,
        if (recurrence != null) 'recurrence': recurrence,
        if (category != null) 'category': category,
      };
}

class MemoryDisplay extends DisplayEntity {
  final String content;

  MemoryDisplay({required this.content}) : super('memory');

  factory MemoryDisplay.fromJson(Map<String, dynamic> json) => MemoryDisplay(
        content: json['content'] as String,
      );

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'content': content,
      };
}

List<DisplayEntity> parseDisplayList(dynamic json) {
  if (json is List) {
    return json
        .map((e) => DisplayEntity.fromJson(e as Map<String, dynamic>))
        .toList();
  }
  return [];
}
