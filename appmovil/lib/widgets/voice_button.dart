import 'dart:math';

import 'package:flutter/material.dart';

import '../services/audio_service.dart';

class VoiceButton extends StatefulWidget {
  final AudioService audioService;

  const VoiceButton({super.key, required this.audioService});

  @override
  State<VoiceButton> createState() => _VoiceButtonState();
}

class _VoiceButtonState extends State<VoiceButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _pulseAnimation;

  AudioServiceState _state = AudioServiceState.idle;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );

    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(
        parent: _animationController,
        curve: Curves.easeInOut,
      ),
    );

    widget.audioService.stateStream.listen((state) {
      if (mounted) {
        setState(() {
          _state = state;
        });
        if (state == AudioServiceState.recording) {
          _animationController.repeat(reverse: true);
        } else {
          _animationController.stop();
          _animationController.value = 0;
        }
      }
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Color get _stateColor {
    switch (_state) {
      case AudioServiceState.idle:
        return Colors.blue;
      case AudioServiceState.recording:
        return Colors.red;
      case AudioServiceState.processing:
        return Colors.orange;
      case AudioServiceState.playing:
        return Colors.green;
    }
  }

  IconData get _stateIcon {
    switch (_state) {
      case AudioServiceState.idle:
        return Icons.mic;
      case AudioServiceState.recording:
        return Icons.mic;
      case AudioServiceState.processing:
        return Icons.hourglass_top;
      case AudioServiceState.playing:
        return Icons.volume_up;
    }
  }

  void _onTap() {
    if (_state == AudioServiceState.idle) {
      widget.audioService.startRecording();
    } else if (_state == AudioServiceState.recording) {
      widget.audioService.stopRecording();
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _onTap,
      child: AnimatedBuilder(
        animation: _animationController,
        builder: (context, child) {
          final scale = _state == AudioServiceState.recording
              ? _pulseAnimation.value
              : 1.0;

          return Transform.scale(
            scale: scale,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _stateColor,
                boxShadow: [
                  BoxShadow(
                    color: _stateColor.withValues(alpha: 0.4),
                    blurRadius: _state == AudioServiceState.recording
                        ? 20 + 10 * sin(_animationController.value * pi * 2)
                        : 10,
                    spreadRadius: _state == AudioServiceState.recording
                        ? 5 + 3 * sin(_animationController.value * pi * 2)
                        : 2,
                  ),
                ],
              ),
              child: Icon(
                _stateIcon,
                size: 80,
                color: Colors.white,
              ),
            ),
          );
        },
      ),
    );
  }
}
