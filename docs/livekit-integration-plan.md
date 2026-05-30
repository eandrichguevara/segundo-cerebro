# Plan de Integración LiveKit — Segundo Cerebro

> **Estado**: Plan aprobado para implementación  
> **Fecha**: 2026-05-29  
> **Objetivo**: Delegar manejo de red y audio a LiveKit, reteniendo control absoluto sobre cerebros (LLM) y voces (TTS), integrándose con el sistema actual de doble vía.

---

## 1. Decisoes Técnicas

| Decisión | Opción Elegida | Justificación |
|----------|---------------|---------------|
| **STT streaming** | Deepgram Nova-3 | Sub-300ms, VAD nativo, $0.0077/min, estándar industria para voice agents |
| **TTS premium** | Cartesia Sonic 3.5 | Voice cloning, ~150ms first token, mencionado en AGENTS.md como provider principal |
| **Estrategia migración** | Fases (paralelo primero) | Menos riesgoso, permite validar LiveKit sin afectar al usuario |
| **Canal control** | Híbrido (WS + LiveKit audio) | LiveKit para audio, WebSocket legacy para action_result/text. Mínimos cambios al backend actual |

---

## 2. Arquitectura Post-Migración

```
┌──────────────────────────────────────────────────────────────────────┐
│  OCI ARM Instance (Ubuntu 24.04, 4 OCPU, 24 GB RAM)                │
│                                                                      │
│  ┌──────────────┐    ┌─────────────────┐    ┌────────────────────┐  │
│  │   Fastify     │    │ LiveKit Server  │    │  LiveKit Agent     │  │
│  │  (WS ctrl)    │    │ (WebRTC Router) │    │  (Node.js worker)  │  │
│  │               │    │                 │    │                    │  │
│  │  /ws (auth,   │    │ TCP 7880 (sig)  │◄──►│  @livekit/rtc-node │  │
│  │   action_res, │    │ UDP 50000-60000 │    │                    │  │
│  │   text, fcm)  │    │ (media relay)   │    │  ┌──────────────┐  │  │
│  └──────┬───────┘    └─────────────────┘    │  │ VAD Pipeline  │  │  │
│         │                                    │  │ ↓             │  │  │
│         │  WebSocket (control)               │  │ Deepgram STT  │  │  │
│         │  (action_result, text,             │  │ ↓             │  │  │
│         │   processing, notification)        │  │ Fast Lane LLM │  │  │
│         │                                    │  │ ↓             │  │  │
│         ▼                                    │  │ Cartesia TTS  │  │  │
│  ┌──────────────────┐                        │  └──────────────┘  │  │
│  │   PostgreSQL     │                        └────────┬───────────┘  │
│  │   (jobs, turns,  │◄─────────────────────────────────┘              │
│  │    memories...)  │      enqueueJob() - misma lógica existente      │
│  └────────┬─────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐                                                │
│  │  Slow Lane       │                                                │
│  │  Worker          │  SIN CAMBIOS - consume jobs de tabla jobs      │
│  │  (action-handlers│                                                │
│  │   format-response│                                                │
│  │   slow-lane-llm) │                                                │
│  └──────────────────┘                                                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
              ▲                                        │
              │ WebRTC (audio)                         │ WebSocket
              │ (mic continuo + TTS playback)          │ (action_result, text)
              │                                        │
  ┌───────────┴────────────────────────┐              │
  │  Flutter App                       │◄─────────────┘
  │  (livekit_client)                  │
  │                                    │
  │  - Mic continuo (sin tap-to-record)│
  │  - Room connection state indicator │
  │  - Botón mute/unmute               │
  │  - Speaker track (TTS streaming)   │
  │  - Barge-in natural por VAD        │
  │  - WebSocket simplificado (solo    │
  │    action_result, text, processing)│
  └────────────────────────────────────┘
```

---

## 3. Flujo Conversacional en Tiempo Real

### 3.1 Conexión Inicial

1. **Flutter** solicita token a `POST /livekit/token` en Fastify
2. **Fastify** genera JWT firmado con `LIVEKIT_API_SECRET`, incluyendo `roomName` y `participantName`
3. **Flutter** se conecta a LiveKit room usando `livekit_client`
4. **LiveKit Agent** detecta `ParticipantJoined` y se suscribe al `AudioTrack` del usuario
5. **Flutter** también inicia WebSocket legacy para mensajes de control

### 3.2 Usuario Habla → STT → Fast Lane → TTS

```
Usuario: "No tengo un camping en mente..."

 1. Mic continuo (WebRTC) → LiveKit Server → Agent
 2. VAD detecta speech → envía audio a Deepgram Nova-3 streaming
 3. VAD detecta silencio (>500ms) → utterance completo
 4. Texto transcrito → Fast Lane (gpt-4.1-mini via fast-lane.ts)
 5. Fast Lane responde: "Claro, a ver..." + tool call para buscar campings
 6. Texto → Cartesia Sonic 3.5 TTS streaming
 7. Chunks de audio → LiveKit room → Flutter speaker
 8. Tool call → enqueueJob() en PostgreSQL (vía lenta)
```

### 3.3 Vía Lenta en Background

```
 9. Slow Lane Worker consume job
10. gpt-5-mini extrae acciones (query_events, respond)
11. Worker ejecuta action handlers
12. Worker envía action_result por WebSocket a Flutter
13. Agent recibe resultado y lo inyecta como contexto al Fast Lane
14. Fast Lane continúa: "...de los que he encontrado hay uno en Pirque..."
```

### 3.4 Interrupción (Barge-in)

```
Usuario (interrumpe): "Ya he ido a ese y no me gusta"

 1. VAD del Agent detecta speech del usuario mientras TTS se reproduce
 2. Agent emite AbortSignal a:
    - Cartesia TTS stream → corta audio instantáneamente
    - Fast Lane LLM en curso → cancela generación
 3. Agent vacía buffer de audio TTS
 4. Silencio en <100ms en el teléfono
 5. Nuevo ciclo VAD → Deepgram → Fast Lane comienza inmediatamente
```

---

## 4. Plan de Implementación por Fases

### Fase 0 — Infraestructura (Días 1-2)

#### 4.1 LiveKit Server en OCI ARM

```bash
# Instalar LiveKit Server (ARM64 binary)
wget https://github.com/livekit/livekit/releases/latest/download/livekit-server-linux-arm64.tar.gz
tar xzf livekit-server-linux-arm64.tar.gz
sudo mv livekit-server /usr/local/bin/

# Verificar
livekit-server --version
```

#### 4.2 Configuración del Servidor

**`deploy/livekit.yaml`** — NUEVO:

```yaml
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  turn_relay_range_start: 50000
  turn_relay_range_end: 52000
  stun_server_host: ""  # LiveKit usa STUN propio
keys:
  "${LIVEKIT_API_KEY}": "${LIVEKIT_API_SECRET}"
redis:
  address: localhost:6379
  use_tls: false
logging:
  level: info
  json: true
```

#### 4.3 Docker Compose — Actualizar

**`deploy/docker-compose.prod.yml`** — Agregar servicios:

```yaml
services:
  # ... postgres existente ...

  redis:
    image: redis:7-alpine
    container_name: segundo-cerebro-redis
    restart: unless-stopped
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  livekit:
    image: livekit/livekit-server:latest
    container_name: segundo-cerebro-livekit
    restart: unless-stopped
    ports:
      - "0.0.0.0:7880:7880"
      - "50000-60000:50000-60000/udp"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
    depends_on:
      redis:
        condition: service_healthy

volumes:
  postgres-data:
  redis-data:
```

#### 4.4 Nginx — Nuevo Virtual Host

**`deploy/nginx/livekit.conf`** — NUEVO:

```nginx
server {
    listen 443 ssl;
    server_name livekit.segundo-cerebro.milo-apps.com;

    ssl_certificate /etc/letsencrypt/live/livekit.segundo-cerebro.milo-apps.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.segundo-cerebro.milo-apps.com/privkey.pem;

    location / {
        proxy_pass http://localhost:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

#### 4.5 OCI Security List — Puertos a Abrir

| State | Source | Protocol | Ports | Description |
|-------|--------|----------|-------|-------------|
| Stateful | `0.0.0.0/0` | UDP | 50000-60000 | LiveKit media relay |
| Stateful | `0.0.0.0/0` | TCP | 7880 | LiveKit signaling (o por Nginx) |

#### 4.6 Variables de Entorno — Nuevas

| Variable | Default | Descripción |
|----------|---------|-------------|
| `LIVEKIT_HOST` | `localhost` | Host del servidor LiveKit |
| `LIVEKIT_PORT` | `7880` | Puerto de signaling |
| `LIVEKIT_API_KEY` | — | API Key para LiveKit |
| `LIVEKIT_API_SECRET` | — | API Secret para LiveKit |
| `LIVEKIT_WS_URL` | `ws://localhost:7880` | WebSocket URL para clientes |
| `DEEPGRAM_API_KEY` | — | API Key de Deepgram Nova-3 |
| `CARTESIA_API_KEY` | — | API Key de Cartesia Sonic |
| `CARTESIA_VOICE_ID` | — | ID de voz clonada en Cartesia |
| `TTS_PROVIDER` | `cartesia` | `cartesia` o `openai` |

**Archivos a modificar:**
- `backend/src/config/env.ts` — schema + defaults
- `deploy/.env.prod.template` — agregar nuevas vars

---

### Fase 1 — Backend: LiveKit Agent + Cartesia TTS (Días 3-7)

#### 4.7 Nuevas Dependencias

**`backend/package.json`**:

```json
{
  "dependencies": {
    "@livekit/rtc-node": "^0.6.0",
    "livekit-server-sdk": "^2.8.0",
    "@cartesia/cartesia-js": "^1.2.0",
    "@deepgram/sdk": "^3.8.0"
  }
}
```

```bash
pnpm add @livekit/rtc-node livekit-server-sdk @cartesia/cartesia-js @deepgram/sdk
```

#### 4.8 Endpoint de Token — `backend/src/api/livekit.ts`

```typescript
import { type FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/livekit/token", async (req, reply) => {
    const { roomName, participantName } = req.body as {
      roomName?: string;
      participantName?: string;
    };

    const room = roomName ?? "default";
    const participant = participantName ?? "mobile-user";

    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: participant,
      ttl: "10m",
    });

    at.addGrant({ roomJoin: true, room });

    const token = at.toJwt();
    logger.info({ room, participant }, "LiveKit token generado");

    return { token, wsUrl: env.LIVEKIT_WS_URL };
  });
}
```

#### 4.9 Módulo LiveKit Agent — `backend/src/livekit/`

**`backend/src/livekit/index.ts`** — Entry point:

```typescript
import { Worker } from "@livekit/agents";
import { logger } from "../config/logger.js";

export function startLiveKitAgent(): () => void {
  const worker = new Worker({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    host: env.LIVEKIT_HOST,
    port: env.LIVEKIT_PORT,
  });

  worker.on("job", async (job) => {
    const { room, participant } = job;

    // Pipeline: VAD → STT → Fast Lane → TTS → Slow Lane
    const vad = createVadPipeline();
    const stt = createDeepgramStream();
    const fastLane = createFastLaneBridge();
    const tts = createCartesiaStream();
    const slowLane = createSlowLaneBridge();

    // Conectar pipeline
    await job.connect();
    logger.info({ room, participant }, "LiveKit Agent conectado a room");

    // Suscribirse al audio track del usuario
    participant.on("trackSubscribed", async (track) => {
      if (track.kind === "audio") {
        await vad.process(track, {
          onSpeech: (audio) => stt.send(audio),
          onUtteranceComplete: async (text) => {
            const fastResponse = await fastLane.process(text);
            if (fastResponse.text) {
              await tts.speak(fastResponse.text, fastResponse.signal);
            }
            if (fastResponse.toolCalls?.length) {
              slowLane.enqueue(text);
            }
          },
          onInterruption: () => {
            fastLane.cancel();
            tts.cancel();
          },
        });
      }
    });
  });

  worker.start();
  logger.info("LiveKit Agent iniciado");

  return () => {
    worker.close();
    logger.info("LiveKit Agent detenido");
  };
}
```

**`backend/src/livekit/vad-pipeline.ts`** — VAD + STT streaming:

```typescript
import { VoiceActivityDetector } from "@livekit/rtc-node";
import { createClient } from "@deepgram/sdk";
import { type AudioTrack } from "@livekit/rtc-node";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const deepgram = createClient(env.DEEPGRAM_API_KEY);

interface VadOptions {
  onSpeech: (audioChunk: Buffer) => void;
  onUtteranceComplete: (text: string) => void;
  onInterruption: () => void;
}

export async function createVadPipeline(
  track: AudioTrack,
  options: VadOptions,
): Promise<void> {
  const vad = new VoiceActivityDetector({
    // LiveKit VAD nativo — config thresholds
    silenceThresholdMs: 500,
    minSpeakingDurationMs: 300,
  });

  const dgConnection = deepgram.listen.live({
    model: "nova-3",
    language: "es",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    endpointing: 500,  // endpointing nativo de Deepgram
    interim_results: false,
    smart_format: true,
  });

  dgConnection.on("transcript", (result) => {
    if (result.is_final) {
      const text = result.channel.alternatives?.[0]?.transcript ?? "";
      if (text.trim()) {
        options.onUtteranceComplete(text.trim());
      }
    }
  });

  dgConnection.on("error", (error) => {
    logger.error({ error }, "Deepgram STT error");
  });

  let isSpeaking = false;
  let isTtsActive = false;

  vad.on("speaking", () => {
    if (isTtsActive) {
      options.onInterruption();
    }
    isSpeaking = true;
  });

  vad.on("silence", () => {
    isSpeaking = false;
  });

  // Leer audio del track y enviar a Deepgram + VAD
  for await (const frame of track.audioFrames()) {
    const pcm16 = frame.data;  // Buffer PCM16 16kHz mono
    vad.push(pcm16);
    if (isSpeaking) {
      dgConnection.send(pcm16);
    }
  }
}

// Para señalizar al pipeline que el TTS está activo
export function setTtsActive(active: boolean): void {
  // Mecanismo: variable compartida o evento
}
```

**`backend/src/livekit/tts-stream.ts`** — TTS streaming con Cartesia:

```typescript
import CartesiaClient from "@cartesia/cartesia-js";
import { type Room } from "@livekit/rtc-node";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { synthesizeText as openaiTtsFallback } from "../llm/tts.js";

const cartesia = new CartesiaClient({
  apiKey: env.CARTESIA_API_KEY,
});

export class TtsStream {
  private aborted = false;
  private currentJob: Promise<void> | null = null;

  constructor(private room: Room) {}

  async speak(
    text: string,
    voiceId: string = env.CARTESIA_VOICE_ID,
    model: string = "sonic-3.5",
  ): Promise<void> {
    this.aborted = false;

    try {
      // Cartesia streaming WebSocket
      const websocket = cartesia.tts.websocket({
        container: "raw",
        encoding: "pcm_f32le",
        sampleRate: 24000,
      });

      await websocket.connect();
      const response = websocket.send({
        model,
        voice: { mode: "id", id: voiceId },
        output: { container: "raw", encoding: "pcm_f32le", sampleRate: 24000 },
        language: "es",
        text,
      });

      // Publicar audio en la room como track remoto
      const audioTrack = await this.room.createAudioTrack("assistant-voice");

      for await (const chunk of response) {
        if (this.aborted) {
          websocket.disconnect();
          // Silencio instantáneo
          audioTrack.sendSilence();
          return;
        }

        if (chunk.type === "chunk") {
          audioTrack.sendFrame(chunk.data);
        }
      }

      websocket.disconnect();
    } catch (error) {
      logger.warn({ error }, "Cartesia TTS falló, usando fallback OpenAI");

      if (!this.aborted) {
        const result = await openaiTtsFallback(text);
        if (result.ok) {
          const audioTrack = await this.room.createAudioTrack("assistant-voice");
          audioTrack.sendFrame(result.value);
        }
      }
    }
  }

  cancel(): void {
    this.aborted = true;
  }
}
```

**`backend/src/livekit/fast-lane-bridge.ts`** — Puente con fast lane:

```typescript
import { getFastResponse } from "../llm/fast-lane.js";
import { FAST_LANE_SYSTEM_PROMPT } from "../llm/prompts/fast-lane-system.js";
import { formatForPrompt } from "../domain/quick-memory.js";
import { logger } from "../config/logger.js";

interface FastLaneResult {
  text: string | null;
  toolCalls: unknown[];
  signal: AbortSignal;
}

export class FastLaneBridge {
  private abortController: AbortController | null = null;

  async process(userText: string): Promise<FastLaneResult> {
    this.abortController = new AbortController();

    const quickContext = formatForPrompt();
    const prompt = quickContext
      ? `${FAST_LANE_SYSTEM_PROMPT}\n\n${quickContext}`
      : FAST_LANE_SYSTEM_PROMPT;

    try {
      const result = await getFastResponse(userText, prompt, {
        signal: this.abortController.signal,
      });

      if (!result.ok) {
        return { text: null, toolCalls: [], signal: this.abortController.signal };
      }

      // Parsear tool calls del fast lane
      const toolCalls = extractToolCalls(result.value);

      return {
        text: result.value,
        toolCalls,
        signal: this.abortController.signal,
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logger.info("Fast lane LLM cancelado por interrupción");
        return { text: null, toolCalls: [], signal: this.abortController.signal! };
      }
      throw error;
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

function extractToolCalls(response: string): unknown[] {
  // Parsear tool calls del formato del fast lane (si existen)
  // Por ahora, placeholder para evolución futura
  return [];
}
```

**`backend/src/livekit/slow-lane-bridge.ts`** — Puente con slow lane:

```typescript
import { enqueueJob } from "../db/repositories/job-repository.js";
import { sendToSession } from "../api/ws.js";
import { logger } from "../config/logger.js";

export class SlowLaneBridge {
  async enqueue(
    transcribedText: string,
    sessionId: string,
    correlationId: string,
    audioFormat: "mp3" | "pcm" = "mp3",
  ): Promise<void> {
    try {
      await enqueueJob({
        correlationId,
        sessionId,
        type: "process_message",
        payload: {
          transcribed_text: transcribedText,
          audio_format: audioFormat,
          received_at: new Date().toISOString(),
        },
      });
      logger.info({ correlationId, sessionId }, "Job encolado desde LiveKit Agent");
    } catch (error) {
      logger.error({ error, correlationId }, "Error encolando job desde Agent");
    }
  }
}
```

#### 4.10 Cartesia TTS — `backend/src/llm/cartesia-tts.ts`

```typescript
import CartesiaClient from "@cartesia/cartesia-js";
import { env } from "../config/env.js";
import { type Result, err, ok } from "../types/result.js";

export enum CartesiaError {
  SYNTHESIS_FAILED = "SYNTHESIS_FAILED",
  TIMEOUT = "CARTESIA_TIMEOUT",
}

let client: CartesiaClient | null = null;

function getClient(): CartesiaClient {
  if (!client) {
    client = new CartesiaClient({ apiKey: env.CARTESIA_API_KEY });
  }
  return client;
}

export async function synthesizeText(
  text: string,
  voiceId?: string,
): Promise<Result<Buffer, CartesiaError>> {
  try {
    const response = await getClient().tts.bytes({
      model: "sonic-3.5",
      voice: { mode: "id", id: voiceId ?? env.CARTESIA_VOICE_ID },
      language: "es",
      text,
      output: { container: "wav", encoding: "pcm_f32le", sampleRate: 24000 },
    });

    return ok(Buffer.from(response));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("timeout") || errMsg.includes("TIMEOUT")) {
      return err(CartesiaError.TIMEOUT);
    }
    return err(CartesiaError.SYNTHESIS_FAILED);
  }
}

export function resetClient(): void {
  client = null;
}
```

---

### Fase 2 — Backend: Simplificar WebSocket (Día 8)

#### 4.11 Modificar `backend/src/api/ws.ts`

Eliminar:

- `audioBuffer: Buffer[]` del estado de conexión
- `encodePcmToWav()`
- `handleAudioChunk()`
- `handleAudioEnd()`
- Import de `transcribeAudio`, `getFastResponse`, `FAST_LANE_SYSTEM_PROMPT`, `formatForPrompt`
- Toda la lógica de vía rápida (fast lane race con timeout)
- Toda la lógica de transcripción

Mantener:

- `auth` — autenticación con token estático
- `register_fcm_token` — registro FCM
- `sendToSession()` — entrega de `action_result`, `text`, `processing`
- Idempotencia de mensajes (`idCache`)
- Rate limiting
- Timeout de inactividad
- `ConversationRole` y `addTurn` (solo para registrar respuestas del slow lane)

El handler de `audio_end` se reemplaza por un no-op o se elimina directamente. El WebSocket ahora solo transporta mensajes de control.

---

### Fase 3 — Flutter: LiveKit Client (Días 9-14)

#### 4.12 Dependencias

**`pubspec.yaml`**:

```yaml
dependencies:
  livekit_client: ^2.5.0
  # Eliminar:
  # web_socket_channel: ^3.0.1
  # record: ^6.0.0
  # uuid: ^4.5.1
```

```bash
flutter pub add livekit_client
flutter pub remove record web_socket_channel uuid
```

#### 4.13 Nuevo Servicio — `lib/services/livekit_service.dart`

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';

enum LiveKitConnectionState {
  disconnected,
  connecting,
  connected,
}

class LiveKitService {
  late final Room _room;
  final _stateController = StreamController<LiveKitConnectionState>.broadcast();
  final _errorController = StreamController<String>.broadcast();

  Stream<LiveKitConnectionState> get stateStream => _stateController.stream;
  Stream<String> get errorStream => _errorController.stream;

  LiveKitConnectionState _state = LiveKitConnectionState.disconnected;
  LiveKitConnectionState get state => _state;

  bool _micEnabled = true;
  bool get isMicEnabled => _micEnabled;

  LiveKitService() {
    _room = Room(
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
      ),
    );

    _room.on<RoomStateChanged>((event) {
      switch (event.state) {
        case RoomState.connected:
          _setState(LiveKitConnectionState.connected);
          break;
        case RoomState.disconnected:
          _setState(LiveKitConnectionState.disconnected);
          break;
        case RoomState.reconnecting:
        case RoomState.connecting:
          _setState(LiveKitConnectionState.connecting);
          break;
      }
    });
  }

  Stream<bool> get remoteAudioActive {
    return _room.remoteParticipants.values
        .expand((p) => p.audioTracks.values)
        .map((track) => track.isEnabled);
    // En la práctica se escucha onTrackSubscribed + stream state
  }

  Future<void> connect(String url, String token) async {
    _setState(LiveKitConnectionState.connecting);
    try {
      await _room.connect(url, token);
      await _room.localParticipant?.setMicrophoneEnabled(true);
    } catch (e) {
      _errorController.add('LiveKit connection failed: $e');
      _setState(LiveKitConnectionState.disconnected);
      rethrow;
    }
  }

  Future<void> toggleMic() async {
    _micEnabled = !_micEnabled;
    await _room.localParticipant?.setMicrophoneEnabled(_micEnabled);
  }

  Future<void> disconnect() async {
    await _room.disconnect();
    _setState(LiveKitConnectionState.disconnected);
  }

  void _setState(LiveKitConnectionState state) {
    _state = state;
    _stateController.add(state);
  }

  void dispose() {
    _room.dispose();
    _stateController.close();
    _errorController.close();
  }
}
```

#### 4.14 Modificar `lib/services/audio_service.dart`

Reemplazar completamente. Ya no usa `AudioRecorder`. Ahora es un wrapper alrededor de `LiveKitService` que expone los mismos streams que el resto de la app espera:

```dart
enum AudioServiceState {
  idle,
  listening,  // mic activo, nadie habla
  speaking,   // usuario hablando (detectado por VAD del server)
  processing, // Agent procesando
  playing,    // Agent hablando (TTS activo)
}

class AudioService {
  final LiveKitService _liveKit;

  final _stateController = StreamController<AudioServiceState>.broadcast();
  Stream<AudioServiceState> get stateStream => _stateController.stream;

  AudioServiceState _state = AudioServiceState.idle;
  AudioServiceState get state => _state;

  AudioService(this._liveKit) {
    // Mapear eventos de LiveKit a estados de AudioService
    _liveKit.stateStream.listen((lkState) {
      if (lkState == LiveKitConnectionState.disconnected) {
        _setState(AudioServiceState.idle);
      } else if (lkState == LiveKitConnectionState.connected) {
        _setState(AudioServiceState.listening);
      }
    });

    // Detectar cuando el Agent habla (remote audio track activo)
    _liveKit.remoteAudioActive.listen((active) {
      if (active) {
        _setState(AudioServiceState.playing);
      } else if (_state == AudioServiceState.playing) {
        _setState(AudioServiceState.listening);
      }
    });
  }

  Future<void> initialize() async {}
  void _setState(AudioServiceState state) {
    _state = state;
    _stateController.add(state);
  }
  void dispose() { _stateController.close(); }
}
```

#### 4.15 Modificar `lib/services/websocket_service.dart`

Eliminar envío de `audio_chunk` y `audio_end`. Mantener solo:

- `connect()` — conexión WS
- `_authenticate()` — auth con token
- `sendMessage()` — para `register_fcm_token`
- Streams: `textStream` (TextMessage, ProcessingMessage), `messageStream` (ActionResultMessage), `errorStream`
- Reconexión con backoff exponencial

Se eliminan:
- `AudioChunkMessage`
- `AudioEndMessage`
- Referencias a `audio` en el handler

#### 4.16 Modificar `lib/screens/home_screen.dart`

- Eliminar referencia a `voice_button.dart` como botón de grabación
- Reemplazar por indicador de estado de LiveKit room
- Botón de mute/unmute del micrófono
- Los mensajes de texto (`TextMessage`, `ProcessingMessage`) siguen fluyendo por WS
- `ActionResultMessage` también llega por WS
- Indicador visual cuando el Agent está hablando (track remoto activo)

#### 4.17 Modificar `lib/widgets/voice_button.dart`

Rediseñar de botón "tap-to-record" a:

- Círculo de estado (conectado/desconectado)
- Animación de pulso cuando el Agent habla
- Tooltip: "Micrófono activo" / "Silenciado"

#### 4.18 Modificar `lib/main.dart`

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();

  // 1. Obtener token LiveKit del backend
  final liveKitToken = await fetchLiveKitToken(AppConfig.apiUrl);

  // 2. Inicializar servicios
  final liveKitService = LiveKitService();
  final wsService = WebSocketService();  // simplificado, solo control
  final audioService = AudioService(liveKitService);
  await audioService.initialize();

  // 3. Conectar
  await liveKitService.connect(AppConfig.liveKitWsUrl, liveKitToken);
  wsService.connect();

  runApp(
    SegundoCerebroApp(
      wsService: wsService,
      audioService: audioService,
      liveKitService: liveKitService,
    ),
  );
}

Future<String> fetchLiveKitToken(String apiUrl) async {
  final response = await http.post(
    Uri.parse('$apiUrl/livekit/token'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'roomName': 'default',
      'participantName': 'mobile-user',
    }),
  );
  return (jsonDecode(response.body) as Map)['token'] as String;
}
```

#### 4.19 Modificar `lib/models/ws_message.dart`

Eliminar clases que ya no se usan desde el cliente:

- `AudioChunkMessage`
- `AudioEndMessage`
- `AudioChunkResponse` (nunca se usó en producción)

Mantener el resto sin cambios.

---

### Fase 4 — Integración y Pruebas (Días 15-18)

#### 4.20 Tests Nuevos

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/src/livekit/fast-lane-bridge.test.ts` | Unit | Puente fast lane con mock |
| `backend/src/livekit/tts-stream.test.ts` | Unit | TTS streaming con mock Cartesia |
| `backend/src/livekit/slow-lane-bridge.test.ts` | Unit | Encolado de jobs |
| `backend/src/llm/cartesia-tts.test.ts` | Unit | Síntesis batch Cartesia |
| `backend/src/api/livekit.test.ts` | Integration | Endpoint de token |
| `appmovil/test/livekit_service_test.dart` | Unit | Estados de conexión |

#### 4.21 Tests a Actualizar

| Archivo | Cambio |
|---------|--------|
| `backend/src/api/ws.test.ts` | Eliminar tests de `audio_chunk`/`audio_end` |
| `appmovil/test/smoke_test.dart` | Actualizar flujo (sin audio_chunk) |

#### 4.22 Pruebas Manuales

1. **Flujo básico**: Conectar app → mic continuo → hablar → recibir respuesta TTS
2. **Barge-in**: Interrumpir al Agent mientras habla → verificar corte instantáneo
3. **Slow lane**: Preguntar por tareas → verificar que `action_result` llega por WS
4. **Reconexión**: Matar WiFi → verificar reconexión LiveKit + WS
5. **Fallback TTS**: Deshabilitar Cartesia → verificar que cae a OpenAI TTS
6. **Latencia**: Medir P95 de VAD→STT→LLM→TTS first token (< 2s objetivo)

#### 4.23 Monitoreo

- LiveKit metrics dashboard (built-in en `:7880/metrics`)
- Logs del Agent con `correlation_id` (formato pino JSON)
- Métricas internas:
  - Latencia P95 del pipeline completo
  - Tasa de interrupciones (barge-in events / total utterances)
  - Tasa de error Deepgram, Cartesia, OpenAI

---

### Fase 5 — Corte y Limpieza (Días 19-20)

1. Validar que LiveKit funciona en producción con la app móvil actualizada
2. Mantener WebSocket legacy como respaldo (clientes que no actualicen)
3. Monitorear latencia y errores por 48h continuo
4. Una vez estable:
   - Opcional: migrar `action_result` a LiveKit data channels
   - Opcional: eliminar WebSocket por completo
   - Actualizar `AGENTS.md` con la nueva arquitectura

---

## 5. Costo Estimado Mensual (100h de conversación)

| Componente | Modelo | Costo estimado |
|------------|--------|----------------|
| **STT streaming** | Deepgram Nova-3 | 100h × 60min × $0.0077 = **~$46** |
| **TTS premium** | Cartesia Sonic 3.5 | ~100h de output = **~$50-80*** |
| **LLM fast lane** | gpt-4.1-mini | ~$2-5 (mismo que hoy) |
| **LLM slow lane** | gpt-5-mini | ~$3-5 (mismo que hoy) |
| **LiveKit Server** | Self-hosted OCI | **$0** (infra existente) |
| **Total adicional** | | **~$100-140/mes** |

*\*Cartesia no publica precios fijos. Tiene $1,000 de crédito inicial. Basado en reports de developers.*

---

## 6. Archivos: Resumen Completo

### Crear (11 archivos)

| Archivo | Propósito |
|---------|-----------|
| `backend/src/livekit/index.ts` | Entry point del LiveKit Agent |
| `backend/src/livekit/vad-pipeline.ts` | VAD + Deepgram STT streaming |
| `backend/src/livekit/tts-stream.ts` | TTS streaming Cartesia Sonic |
| `backend/src/livekit/fast-lane-bridge.ts` | Puente con fast lane LLM |
| `backend/src/livekit/slow-lane-bridge.ts` | Puente con slow lane jobs |
| `backend/src/llm/cartesia-tts.ts` | Implementación Cartesia SDK |
| `backend/src/api/livekit.ts` | Endpoint `POST /livekit/token` |
| `appmovil/lib/services/livekit_service.dart` | Cliente Flutter LiveKit |
| `deploy/livekit.yaml` | Configuración servidor LiveKit |
| `deploy/nginx/livekit.conf` | Config Nginx para LiveKit signaling |
| `docs/livekit-integration-plan.md` | Este documento |

### Modificar (10 archivos)

| Archivo | Cambio |
|---------|--------|
| `backend/src/api/ws.ts` | Eliminar audioBuffer, handleAudioChunk, handleAudioEnd, transcribe, fast lane |
| `backend/package.json` | Agregar `@livekit/rtc-node`, `livekit-server-sdk`, `@cartesia/cartesia-js`, `@deepgram/sdk` |
| `backend/src/config/env.ts` | Agregar vars LiveKit, Deepgram, Cartesia |
| `appmovil/pubspec.yaml` | Agregar `livekit_client`, eliminar `record` y `web_socket_channel` |
| `appmovil/lib/services/audio_service.dart` | Reescribir (wrapper de LiveKitService) |
| `appmovil/lib/services/websocket_service.dart` | Simplificar (solo control messages) |
| `appmovil/lib/screens/home_screen.dart` | Adaptar UI (sin tap-to-record) |
| `appmovil/lib/widgets/voice_button.dart` | Rediseñar a indicador de estado |
| `appmovil/lib/models/ws_message.dart` | Eliminar AudioChunkMessage, AudioEndMessage |
| `appmovil/lib/main.dart` | Agregar LiveKitService, fetch token |
| `deploy/docker-compose.prod.yml` | Agregar redis + livekit services |
| `deploy/.env.prod.template` | Agregar nuevas variables |
| `docs/infra-setup.md` | Agregar puertos LiveKit + TURN |
| `AGENTS.md` | Nueva sección "LiveKit Integration" |

### Sin Cambios (se reutiliza)

| Archivo | Razón |
|---------|-------|
| `backend/src/workers/slow-lane-processor.ts` | No sabe ni le importa de dónde vino el audio |
| `backend/src/workers/action-handlers.ts` | Sin cambios — mismos handlers |
| `backend/src/workers/format-response.ts` | Sin cambios — mismo formateo |
| `backend/src/domain/quick-memory.ts` | Sin cambios — sigue siendo actualizada por slow lane |
| `backend/src/llm/fast-lane.ts` | Sin cambios — el Agent lo invoca igual |
| `backend/src/llm/slow-lane.ts` | Sin cambios — el worker lo usa igual |
| `backend/src/llm/stt.ts` | Se mantiene como fallback batch para consolidación |
| `backend/src/llm/tts.ts` | Se mantiene como fallback TTS (OpenAI) |
| `backend/src/db/repositories/*` | Todos sin cambios |
| `backend/prisma/schema.prisma` | Sin cambios |
| `backend/src/auth/index.ts` | Sin cambios |
| `backend/src/types/result.ts` | Sin cambios |
| `backend/src/notifications/*` | Sin cambios |

---

## 7. Consideraciones Técnicas

### 7.1 WebRTC en OCI ARM

- LiveKit Server tiene binario ARM64 precompilado para Linux
- Los puertos UDP 50000-60000 deben estar abiertos en OCI Security List
- LiveKit incluye TURN nativo: configurar `turn_relay_range_start` y `turn_relay_range_end`
- Para clientes en redes corporativas restrictivas, puede ser necesario forzar TURN mode
- LiveKit soporta `STUN` propio, no requiere servidor STUN externo

### 7.2 Manejo de Interrupciones (Barge-in)

El mecanismo de interrupción tiene 3 niveles:

1. **VAD de LiveKit**: detecta speech del usuario mientras el TTS está activo
2. **AbortSignal**: cancela la generación del LLM (vía rápida) en curso
3. **Cancelación del stream TTS**: corta la reproducción de audio en el cliente

El tiempo objetivo de corte es <100ms desde que el usuario empieza a hablar hasta que el TTS se silencia.

### 7.3 Fallback TTS

Si Cartesia falla (timeout, error de API, rate limit):

1. El Agent detecta el error
2. Llama a `synthesizeText()` de `backend/src/llm/tts.ts` (OpenAI TTS, `tts-1-hd`, voz `nova`)
3. Envía el audio generado como track en la room
4. Loggea el fallo para monitoreo

### 7.4 Deepgram Nova-3: Configuración

- Modelo: `nova-3`
- Language: `es` (español)
- Encoding: `linear16` (PCM 16-bit, formato nativo del mic)
- Sample rate: 16000
- Endpointing: 500ms (detección de fin de frase)
- Smart format: true (formato automático de números, fechas, etc.)

### 7.5 Latencia Esperada

| Etapa | Latencia P95 |
|-------|-------------|
| VAD detection | ~100ms |
| Deepgram streaming STT | ~300ms (first token), ~500ms (full utterance) |
| Fast lane LLM (gpt-4.1-mini) | ~800ms |
| Cartesia TTS first chunk | ~150ms |
| **Total end-to-end** | **~1.5-2s** (vs ~3-5s actual con Whisper batch) |

---

## 8. Glosario

| Término | Definición |
|---------|------------|
| **LiveKit Agent** | Proceso Node.js que se conecta a una sala LiveKit y orquesta el pipeline VAD → STT → LLM → TTS |
| **VAD** | Voice Activity Detection — detección de cuándo un humano está hablando |
| **Barge-in** | Capacidad de interrumpir al asistente mientras habla |
| **WebRTC** | Protocolo de comunicación en tiempo real para audio/video peer-to-peer |
| **TURN** | Traversal Using Relays around NAT — relay de audio cuando el P2P no es posible |
| **Room** | Sala virtual de LiveKit donde los participantes intercambian audio/video |
| **Track** | Flujo de audio o video dentro de una room de LiveKit |
| **STT** | Speech-to-Text (Deepgram Nova-3 en este plan) |
| **TTS** | Text-to-Speech (Cartesia Sonic 3.5 en este plan) |
