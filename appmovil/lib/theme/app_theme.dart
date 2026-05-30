import 'package:flutter/material.dart';

// Priority colors
const priorityHighColor = Color(0xFFE53935);
const priorityMediumColor = Color(0xFFFFB300);
const priorityLowColor = Color(0xFF43A047);

Color priorityColor(String priority) => switch (priority) {
      'high' => priorityHighColor,
      'medium' => priorityMediumColor,
      'low' => priorityLowColor,
      _ => Colors.grey,
    };

String priorityEmoji(String priority) => switch (priority) {
      'high' => '🔴',
      'medium' => '🟡',
      'low' => '🟢',
      _ => '',
    };

// Status colors
const statusPendingColor = Color(0xFF90A4AE);
const statusInProgressColor = Color(0xFF42A5F5);
const statusCompletedColor = Color(0xFF66BB6A);
const statusPostponedColor = Color(0xFFFFA726);
const statusCancelledColor = Color(0xFFEF5350);
const statusActiveColor = Color(0xFF42A5F5);
const statusPausedColor = Color(0xFFFFA726);

Color statusColor(String status) => switch (status) {
      'pending' => statusPendingColor,
      'in_progress' => statusInProgressColor,
      'completed' => statusCompletedColor,
      'postponed' => statusPostponedColor,
      'cancelled' => statusCancelledColor,
      'active' => statusActiveColor,
      'paused' => statusPausedColor,
      _ => Colors.grey,
    };

String statusEmoji(String status) => switch (status) {
      'pending' => '⏳',
      'in_progress' => '🔄',
      'completed' => '✅',
      'postponed' => '⏰',
      'cancelled' => '❌',
      'active' => '▶️',
      'paused' => '⏸️',
      _ => '',
    };

String statusLabel(String status) => switch (status) {
      'pending' => 'Pendiente',
      'in_progress' => 'En progreso',
      'completed' => 'Completada',
      'postponed' => 'Pospuesta',
      'cancelled' => 'Cancelada',
      'active' => 'Activo',
      'paused' => 'En pausa',
      _ => status,
    };

// Card background tints (very subtle)
Color cardTint(Color accent) => accent.withValues(alpha: 0.08);
