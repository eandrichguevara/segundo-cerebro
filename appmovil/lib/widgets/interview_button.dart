import 'package:flutter/material.dart';

const _kInterviewColor = Color(0xFF00BCD4);

class InterviewButton extends StatefulWidget {
  final bool isActive;
  final bool isEnabled;
  final VoidCallback onTap;

  const InterviewButton({
    super.key,
    required this.isActive,
    required this.isEnabled,
    required this.onTap,
  });

  @override
  State<InterviewButton> createState() => _InterviewButtonState();
}

class _InterviewButtonState extends State<InterviewButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _glowController;

  @override
  void initState() {
    super.initState();
    _glowController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void dispose() {
    _glowController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color =
        widget.isEnabled
            ? (widget.isActive
                ? _kInterviewColor
                : _kInterviewColor.withValues(alpha: 0.6))
            : Colors.grey;

    if (widget.isActive) {
      _glowController.repeat(reverse: true);
    } else {
      _glowController.stop();
      _glowController.reset();
    }

    return GestureDetector(
      onTap: widget.isEnabled ? widget.onTap : null,
      child: AnimatedBuilder(
        animation: _glowController,
        builder: (context, child) {
          return AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color,
              boxShadow:
                  widget.isActive
                      ? [
                        BoxShadow(
                          color: _kInterviewColor.withValues(
                            alpha: 0.3 + (_glowController.value * 0.2),
                          ),
                          blurRadius: 12 + (_glowController.value * 6),
                          spreadRadius: 1,
                        ),
                      ]
                      : [],
            ),
            child: Icon(
              widget.isActive ? Icons.stop : Icons.forum,
              color: Colors.white,
              size: 22,
            ),
          );
        },
      ),
    );
  }
}
