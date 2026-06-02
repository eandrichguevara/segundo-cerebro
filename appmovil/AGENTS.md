# 🤖 Agent Context & Memory (Proyecto: App Móvil)

## 🎯 Objetivo del Proyecto

Cliente móvil **voice-first** (Flutter) para "Segundo Cerebro". Captura audio PCM, lo envía vía WebSocket al backend, y renderiza respuestas de texto y tarjetas visuales estructuradas (tareas, listas, objetivos, eventos, memorias). Toda la lógica de negocio vive en el backend. La app es solo **presentación + captura de audio**.

## 🛠️ Stack Tecnológico & Restricciones

- **Lenguaje/Entorno:** Dart 3.7+ (Flutter)
- **Framework UI:** Flutter con Material 3, tema oscuro
- **Dependencias clave:** `web_socket_channel`, `record` (PCM 16-bit 16kHz mono), `uuid`, `flutter_dotenv`, `shared_preferences`
- **Testing:** `flutter_test` (smoke tests en `test/smoke_test.dart`)
- **Package manager:** pub (Flutter SDK)
- **Linting:** `flutter_lints` (configurado en `analysis_options.yaml`)

## 📐 Arquitectura Propuesta

### Estructura de carpetas

`/lib/config`, `/lib/models`, `/lib/screens`, `/lib/services`, `/lib/theme`, `/lib/widgets`

### Comunicación

- Exclusivamente vía WebSocket (sin REST)
- Protocolo definido en `backend/AGENTS.md` (sección WebSocket Protocol)
- Estado manejado con streams (sin BLoC/Riverpod en MVP)

### Display estructurado

La app recibe mensajes WS `display` con entidades estructuradas y las renderiza con widgets nativos.

**Widgets** (`appmovil/lib/widgets/display_cards.dart`):
- `TaskCard`: barra lateral 🔴🟡🟢, badge de estado, fecha opcional
- `ListCard`: items con ☐/☑, barra de progreso, contador
- `ObjectiveCard`: barra lateral según estado, badge, deadline
- `EventCard`: hora, ubicación, recurrencia, badge de categoría
- `MemoryCard`: contenido en itálica con 🧠
- `StatusBadge`: badge reutilizable por estado

**Historial persistente**: el chat usa `ListView.builder` con `ChatItem` sellado (`TextItem`, `DisplayItem`, `ProcessingItem`). Persiste entre sesiones via `shared_preferences` (JSON, max 200 items).

**Modelos** (`appmovil/lib/models/`):
- `display_entity.dart`: modelos Dart sellados con `fromJson`
- `chat_item.dart`: `ChatItem` sellado (`TextItem`, `DisplayItem`, `ProcessingItem`)
- `ws_message.dart`: parseo con `parseServerMessage()`, clase `DisplayMessage`

**Streams**: `WebSocketService` expone `displayStream` para entidades estructuradas.

### Ciclo de vida del audio

- `AudioService` con estados: `idle` → `recording` → `processing`
- Captura PCM 16-bit, 16kHz, mono con `record` package
- Tap-to-record (sin micrófono continuo)
- Timeout de seguridad (30s) en estado `processing`

### Reconexión

- Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 30s cap
- Al reconectar, reenviar `auth` como primer mensaje
- No reenvío de `audio_chunk` del turno anterior

## 🚦 Estado Actual e Hitos de Automatización

- [x] Inicialización del proyecto Flutter (`pubspec.yaml` configurado)
- [x] Captura de audio (PCM 16-bit, 16kHz, mono) con `AudioService`
- [x] Conexión WebSocket con auth, reconexión con backoff exponencial
- [x] Protocolo completo de mensajes (auth, audio_chunk, audio_end, register_fcm_token)
- [x] Display estructurado nativo (TaskCard, ListCard, ObjectiveCard, EventCard, MemoryCard)
- [x] Chat history persistente con `shared_preferences` (máx 200 items)
- [x] Timeout de seguridad (30s) en estado `processing`
- [x] Smoke tests de mensajes WS (`test/smoke_test.dart`)
- [x] Integración de Firebase Cloud Messaging (FCM) — registro de token implementado y conectado al flujo, notificaciones ongoing de eventos con entidades enlazadas
- [ ] Soporte de `audio_format: pcm` en lado cliente
- [ ] Tests de widgets e integración

## 📌 Reglas Generales para el Agente (Modo Build)

1. Toda la lógica de negocio vive en `backend/`; la app móvil es solo cliente de voz + presentación.
2. El protocolo WebSocket está definido en `backend/AGENTS.md`. Cualquier cambio en el protocolo debe reflejarse en ambos lados.
3. Antes de dar un cambio por terminado en `models/` o `services/`, ejecuta `flutter test`.
4. No introduzcas dependencias sin preguntar primero. Las aprobadas: `web_socket_channel`, `record`, `uuid`, `flutter_dotenv`, `shared_preferences`.
5. Los mensajes cliente→servidor se serializan con `toJsonString()`. Los mensajes servidor→cliente se parsean con `parseServerMessage()` en `ws_message.dart`.
6. Los streams expuestos por `WebSocketService` son la única fuente de datos para la UI.
7. No uses `any` o casteos inseguros — usa tipos sellados (`sealed class`) en los modelos.
