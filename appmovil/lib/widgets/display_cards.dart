import 'package:flutter/material.dart';

import '../models/display_entity.dart';
import '../theme/app_theme.dart';

/// Renders any DisplayEntity as the appropriate card widget
class DisplayEntityCard extends StatelessWidget {
  final DisplayEntity entity;

  const DisplayEntityCard({super.key, required this.entity});

  @override
  Widget build(BuildContext context) {
    return switch (entity) {
      TaskDisplay e => _TaskCard(entity: e),
      ListDisplay e => _ListCard(entity: e),
      ObjectiveDisplay e => _ObjectiveCard(entity: e),
      EventDisplay e => _EventCard(entity: e),
      MemoryDisplay e => _MemoryCard(entity: e),
    };
  }
}

// ─── Task Card ───

class _TaskCard extends StatelessWidget {
  final TaskDisplay entity;
  const _TaskCard({required this.entity});

  @override
  Widget build(BuildContext context) {
    final accent = priorityColor(entity.priority);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardTint(accent),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent.withValues(alpha: 0.3)),
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            Container(
              width: 4,
              decoration: BoxDecoration(
                color: accent,
                borderRadius:
                    const BorderRadius.horizontal(left: Radius.circular(12)),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          priorityEmoji(entity.priority),
                          style: const TextStyle(fontSize: 14),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            entity.title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        _StatusBadge(status: entity.status),
                      ],
                    ),
                    if (entity.dueDate != null) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Text('📅 ',
                              style: TextStyle(fontSize: 12)),
                          Text(
                            _formatDate(entity.dueDate!),
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.6),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}';
    } catch (_) {
      return iso;
    }
  }
}

// ─── List Card ───

class _ListCard extends StatelessWidget {
  final ListDisplay entity;
  const _ListCard({required this.entity});

  @override
  Widget build(BuildContext context) {
    final checkedCount = entity.items.where((i) => i.checked).length;
    final totalCount = entity.items.length;
    final progress = totalCount > 0 ? checkedCount / totalCount : 0.0;
    final allChecked = checkedCount == totalCount && totalCount > 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardTint(const Color(0xFF66BB6A)),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(0xFF66BB6A).withValues(alpha: 0.3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('📋 ', style: TextStyle(fontSize: 14)),
                Expanded(
                  child: Text(
                    entity.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  '$checkedCount/$totalCount',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.5),
                    fontSize: 13,
                  ),
                ),
              ],
            ),
            if (totalCount > 0) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: progress,
                  backgroundColor: Colors.white.withValues(alpha: 0.1),
                  valueColor: AlwaysStoppedAnimation<Color>(
                    allChecked
                        ? const Color(0xFF66BB6A)
                        : const Color(0xFFFFB300),
                  ),
                  minHeight: 3,
                ),
              ),
              const SizedBox(height: 8),
              ...entity.items.map((item) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.checked ? '☑' : '☐',
                          style: TextStyle(
                            fontSize: 14,
                            color: item.checked
                                ? const Color(0xFF66BB6A)
                                : Colors.white.withValues(alpha: 0.5),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            item.quantity != null
                                ? '${item.content} (${item.quantity})'
                                : item.content,
                            style: TextStyle(
                              color: item.checked
                                  ? Colors.white.withValues(alpha: 0.4)
                                  : Colors.white,
                              fontSize: 14,
                              decoration: item.checked
                                  ? TextDecoration.lineThrough
                                  : null,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )),
            ],
          ],
        ),
      ),
    );
  }
}

// ─── Objective Card ───

class _ObjectiveCard extends StatelessWidget {
  final ObjectiveDisplay entity;
  const _ObjectiveCard({required this.entity});

  @override
  Widget build(BuildContext context) {
    final accent = statusColor(entity.status);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardTint(accent),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent.withValues(alpha: 0.3)),
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            Container(
              width: 4,
              decoration: BoxDecoration(
                color: accent,
                borderRadius:
                    const BorderRadius.horizontal(left: Radius.circular(12)),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text('🎯 ', style: TextStyle(fontSize: 14)),
                        Expanded(
                          child: Text(
                            entity.title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        _StatusBadge(status: entity.status),
                      ],
                    ),
                    if (entity.deadline != null) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Text('📅 ',
                              style: TextStyle(fontSize: 12)),
                          Text(
                            'Límite: ${_formatDate(entity.deadline!)}',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.6),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}';
    } catch (_) {
      return iso;
    }
  }
}

// ─── Event Card ───

class _EventCard extends StatelessWidget {
  final EventDisplay entity;
  const _EventCard({required this.entity});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardTint(const Color(0xFFFF7043)),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(0xFFFF7043).withValues(alpha: 0.3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('📅 ', style: TextStyle(fontSize: 14)),
                Expanded(
                  child: Text(
                    entity.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (entity.category != null)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF7043).withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      entity.category!,
                      style: TextStyle(
                        color: const Color(0xFFFF7043).withValues(alpha: 0.9),
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                const Text('🕐 ', style: TextStyle(fontSize: 12)),
                Text(
                  _formatTimeRange(entity.startTime, entity.endTime),
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 13,
                  ),
                ),
              ],
            ),
            if (entity.location != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Text('📍 ', style: TextStyle(fontSize: 12)),
                  Text(
                    entity.location!,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ],
            if (entity.recurrence != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Text('🔄 ', style: TextStyle(fontSize: 12)),
                  Text(
                    entity.recurrence!,
                    style: TextStyle(
                      color: const Color(0xFFFFB300).withValues(alpha: 0.8),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatTimeRange(String start, String? end) {
    try {
      final startDt = DateTime.parse(start);
      final timeStr =
          '${startDt.day}/${startDt.month} ${startDt.hour.toString().padLeft(2, '0')}:${startDt.minute.toString().padLeft(2, '0')}';
      if (end != null) {
        final endDt = DateTime.parse(end);
        final endStr =
            '${endDt.hour.toString().padLeft(2, '0')}:${endDt.minute.toString().padLeft(2, '0')}';
        return '$timeStr - $endStr';
      }
      return timeStr;
    } catch (_) {
      return '$start${end != null ? ' - $end' : ''}';
    }
  }
}

// ─── Memory Card ───

class _MemoryCard extends StatelessWidget {
  final MemoryDisplay entity;
  const _MemoryCard({required this.entity});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: cardTint(const Color(0xFFAB47BC)),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(0xFFAB47BC).withValues(alpha: 0.3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('🧠 ', style: TextStyle(fontSize: 14)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                entity.content,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.85),
                  fontSize: 14,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Status Badge ───

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        '${statusEmoji(status)} ${statusLabel(status)}',
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}
