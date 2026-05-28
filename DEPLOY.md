# Deploy Guide — Segundo Cerebro

## Índice

1. [Prerequisitos](#1-prerequisitos)
2. [Estructura de archivos de deploy](#2-estructura-de-archivos-de-deploy)
3. [Preparar el servidor (una sola vez)](#3-preparar-el-servidor-una-sola-vez)
4. [Dockerfile del backend](#4-dockerfile-del-backend)
5. [Docker Compose producción](#5-docker-compose-producción)
6. [Nginx reverse proxy](#6-nginx-reverse-proxy)
7. [GitHub Actions CI/CD](#7-github-actions-cicd)
   - [Secrets necesarios](#71-secrets-necesarios)
   - [Workflow: test + build + deploy](#72-workflow-test--build--deploy)
8. [Primer deploy manual](#8-primer-deploy-manual)
9. [Build APK para Android](#9-build-apk-para-android)
10. [Actualizar la app](#10-actualizar-la-app)
11. [Resolución de problemas](#11-resolución-de-problemas)

---

## 1. Prerequisitos

### Local (tu máquina)

| Herramienta                                                       | Versión | Para qué                |
| ----------------------------------------------------------------- | ------- | ----------------------- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | última  | Build de imágenes local |
| [Flutter](https://docs.flutter.dev/get-started/install)           | 3.7+    | Build del APK           |
| [GitHub CLI](https://cli.github.com/) (`gh`)                      | última  | Manejar secrets         |
| Cuenta en [Docker Hub](https://hub.docker.com/)                   | gratis  | Registry de imágenes    |

### Servidor (Oracle Cloud)

| Recurso                             | Detalle                              |
| ----------------------------------- | ------------------------------------ |
| Instancia ARM (VM.Standard.A1.Flex) | 2 OCPU, 6 GB RAM, Ubuntu 22.04/24.04 |
| Puertos abiertos                    | 22 (SSH), 80 (HTTP), 443 (HTTPS)     |
| Dominio                             | `segundo-cerebro.tudominio.com`      |
| Docker + Docker Compose             | se instalan en el setup inicial      |

### Mobile (Android)

| Requisito              | Detalle                         |
| ---------------------- | ------------------------------- |
| Android 8.0+ (API 26+) | SDK mínimo del `record` package |
| Permiso de micrófono   | se configura en este documento  |
| Conexión a internet    | al servidor directamente        |

---

## 2. Estructura de archivos de deploy

Crear esta estructura dentro del repo:

```
segundo-cerebro/
├── .github/
│   └── workflows/
│       └── deploy.yml              # CI/CD pipeline
├── backend/
│   ├── Dockerfile                  # Multi-stage build
│   └── .dockerignore
├── deploy/
│   ├── docker-compose.prod.yml     # Orquestación producción
│   ├── nginx/
│   │   └── segundo-cerebro.conf    # Reverse proxy config
│   ├── .env.prod.template          # Template de env para servidor
│   └── setup-server.sh             # Script de setup inicial
├── docker-compose.yml              # (existente) Solo postgres dev
└── DEPLOY.md                       # Este archivo
```

Cada archivo se detalla en las secciones siguientes.

---

## 3. Preparar el servidor (una sola vez)

Seguir la guía detallada en [`docs/infra-setup.md`](docs/infra-setup.md) para:

1. Crear instancia OCI ARM
2. Abrir puertos en Security List (80, 443, 22)
3. Configurar DNS (registro A apuntando a la IP pública)
4. SSH a la instancia
5. Instalar dependencias base (nginx, certbot, ufw)
6. **Opcional: instalar PostgreSQL nativo** (alternativa a Docker)

> **Decisión**: PostgreSQL puede correr nativo en el host (como indica `docs/infra-setup.md`) o como container Docker. Si usás Docker, salteá el paso 6 del setup manual y usá el `docker-compose.prod.yml` que incluye PostgreSQL. La ventaja de Docker es que todo se deploya con un solo comando; la ventaja de nativo es que los datos no dependen del ciclo de vida de containers.

### Asignación de recursos en la instancia

Con la instancia configurada a **2 OCPU / 6 GB RAM**, esta es la distribución recomendada para los containers:

| Servicio              | RAM asignada | CPU asignada | Uso real típico        |
| --------------------- | ------------ | ------------ | ---------------------- |
| PostgreSQL + pgvector | 2 GB (máx)   | 1 OCPU       | ~300-500 MB            |
| Backend (Node.js)     | 512 MB (máx) | 0.5 OCPU     | ~50-100 MB             |
| Nginx                 | 256 MB (máx) | 0.25 OCPU    | ~20-30 MB              |
| Sistema + buffers     | ~3.2 GB      | disponible   | cache de disco, kernel |

> El resto de la RAM queda disponible para cache de disco y buffers de PostgreSQL. Los límites están puestos en el `docker-compose.prod.yml` para que ningún container se descontrole.

### Setup rápido del servidor

SSH a la instancia y ejecutar:

```bash
# Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo apt install -y docker-compose-plugin
# Cerrar sesión y volver a entrar para aplicar grupos

# Nginx + Certbot + UFW
sudo apt install -y nginx certbot python3-certbot-nginx ufw

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Verificar
docker --version
docker compose version
nginx -v
```

---

## 4. Dockerfile del backend

Crear `backend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# Stage 1: build
FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY prisma/ ./prisma/
RUN pnpm prisma:generate

COPY src/ ./src/
RUN pnpm build

# Stage 2: runtime
FROM node:20-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

ENV NODE_ENV=production

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile --prod

COPY prisma/ ./prisma/
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/.prisma/ ./node_modules/.prisma/

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Crear `backend/.dockerignore`:

```
node_modules/
dist/
.env
.git
.gitignore
*.test.ts
tests/
```

---

## 5. Docker Compose producción

Crear `deploy/docker-compose.prod.yml`:

```yaml
name: segundo-cerebro

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: sc-db
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: segundo_cerebro
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: segundo_cerebro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U segundo_cerebro -d segundo_cerebro"]
      interval: 5s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 2G
        reservations:
          cpus: "0.5"
          memory: 512M
    networks:
      - sc-net

  backend:
    image: ${DOCKER_REGISTRY:-docker.io}/${DOCKER_USER}/segundo-cerebro:${IMAGE_TAG:-latest}
    container_name: sc-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://segundo_cerebro:${DB_PASSWORD}@postgres:5432/segundo_cerebro?schema=public
      AUTH_TOKEN: ${AUTH_TOKEN}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      FCM_SERVICE_ACCOUNT: /etc/secrets/fcm-service-account.json
      LOG_LEVEL: ${LOG_LEVEL:-info}
    volumes:
      - ./fcm-service-account.json:/etc/secrets/fcm-service-account.json:ro
    networks:
      - sc-net
    labels:
      - "traefik.enable=false"

  nginx:
    image: nginx:alpine
    container_name: sc-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/segundo-cerebro.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 64M
    networks:
      - sc-net

volumes:
  pgdata:

networks:
  sc-net:
    driver: bridge
```

**Explicación**:

- `postgres`: base de datos con pgvector, datos persistentes en volume `pgdata`
- `backend`: app Node.js, conecta a postgres por hostname interno (`postgres:5432`)
- `nginx`: reverse proxy con SSL termination, proxy a backend en `backend:3000`
- todas las variables sensibles vienen del archivo `.env` (o de secrets en CI/CD)
- `FCM_SERVICE_ACCOUNT` se monta como archivo read-only

> **PostgreSQL nativo**: si preferís PostgreSQL instalado nativo (no en Docker), cambiá `DATABASE_URL` a `host.docker.internal:5432` o a la IP del host, y eliminá el servicio `postgres` del compose. El backend corre en Docker pero apunta al postgres del host.

---

## 6. Nginx reverse proxy

Crear `deploy/nginx/segundo-cerebro.conf`:

```nginx
upstream backend {
    server backend:3000;
}

server {
    listen 80;
    server_name segundo-cerebro.tudominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name segundo-cerebro.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/segundo-cerebro.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/segundo-cerebro.tudominio.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;

    # Health check
    location /health {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # API / fallback
    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

> **Nota**: reemplazar `segundo-cerebro.tudominio.com` por tu dominio real.

---

## 7. GitHub Actions CI/CD

### 7.1 Secrets necesarios

Configurar estos secrets en el repo de GitHub (Settings → Secrets and variables → Actions):

| Secret                | Valor                           | Obtención                                   |
| --------------------- | ------------------------------- | ------------------------------------------- |
| `DOCKER_USER`         | usuario de Docker Hub           | registro en hub.docker.com                  |
| `DOCKER_PASSWORD`     | token/password de Docker Hub    | generar en hub.docker.com/settings/security |
| `OCI_SSH_HOST`        | IP pública del servidor OCI     | consola OCI                                 |
| `OCI_SSH_USER`        | `ubuntu`                        | usuario por defecto en Ubuntu               |
| `OCI_SSH_KEY`         | contenido de `id_rsa` (privada) | `cat ~/.ssh/id_rsa`                         |
| `AUTH_TOKEN`          | token de auth del backend       | generar con `openssl rand -hex 32`          |
| `OPENAI_API_KEY`      | API key de OpenAI               | platform.openai.com/api-keys                |
| `DB_PASSWORD`         | password de PostgreSQL          | generar con `openssl rand -hex 16`          |
| `FCM_SERVICE_ACCOUNT` | contenido del JSON de Firebase  | consola Firebase → Service Account          |
| `LOG_LEVEL`           | `info`                          | default                                     |

### 7.2 Workflow: test + build + deploy

Crear `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  DOCKER_REGISTRY: docker.io
  IMAGE_NAME: ${{ secrets.DOCKER_USER }}/segundo-cerebro

jobs:
  test:
    name: Test & Lint
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: backend/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma:generate
      - run: pnpm test
      - run: pnpm lint

  build-and-push:
    name: Build & Push Docker Image
    needs: test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USER }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Generate image tag
        id: tag
        run: echo "tag=$(date +%Y%m%d-%H%M%S)-${{ github.sha }}" >> $GITHUB_OUTPUT

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: backend
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:latest
            ${{ env.IMAGE_NAME }}:${{ steps.tag.outputs.tag }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to OCI
    needs: build-and-push
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Copy deploy files to server
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.OCI_SSH_HOST }}
          username: ${{ secrets.OCI_SSH_USER }}
          key: ${{ secrets.OCI_SSH_KEY }}
          source: "deploy/*"
          target: "/home/ubuntu/segundo-cerebro"
          strip_components: 1

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.OCI_SSH_HOST }}
          username: ${{ secrets.OCI_SSH_USER }}
          key: ${{ secrets.OCI_SSH_KEY }}
          script: |
            set -e

            cd /home/ubuntu/segundo-cerebro

            # Crear .env si no existe
            if [ ! -f .env ]; then
              cat > .env << 'EOF'
            AUTH_TOKEN=${{ secrets.AUTH_TOKEN }}
            OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}
            DB_PASSWORD=${{ secrets.DB_PASSWORD }}
            LOG_LEVEL=${{ secrets.LOG_LEVEL }}
            DOCKER_USER=${{ secrets.DOCKER_USER }}
            IMAGE_TAG=latest
            EOF
            fi

            # Firebase service account (si cambió)
            echo '${{ secrets.FCM_SERVICE_ACCOUNT }}' > fcm-service-account.json

            # Pull latest image
            docker compose -f docker-compose.prod.yml pull

            # Apply migrations
            docker compose -f docker-compose.prod.yml run --rm \
              -e DATABASE_URL="postgresql://segundo_cerebro:${{ secrets.DB_PASSWORD }}@postgres:5432/segundo_cerebro?schema=public" \
              backend npx prisma migrate deploy

            # Restart services
            docker compose -f docker-compose.prod.yml up -d --remove-orphans

            # Cleanup old images
            docker image prune -af
```

**Flujo del workflow**:

1. **test**: checkout → pnpm install → prisma generate → test → lint
2. **build-and-push**: build Docker image (con cache) → push a Docker Hub con tag `latest` + tag fechado
3. **deploy**: SCP de archivos de deploy → SSH al servidor → pull imagen → correr migraciones → restart containers

> **Nota**: el workflow asume que el servidor ya tiene Docker, Docker Compose, y los puertos/configuración inicial hechos (sección 3).

---

## 8. Primer deploy manual

Antes de que el CI/CD funcione automáticamente, hay que hacer un deploy manual para dejar el servidor listo.

### 8.1 En tu máquina local

```bash
# 1. Buildear la imagen
docker build -t segundo-cerebro:latest backend/

# 2. Pushear a Docker Hub
docker tag segundo-cerebro:latest tuusuario/segundo-cerebro:latest
docker push tuusuario/segundo-cerebro:latest
```

### 8.2 En tu máquina local (subir archivos de deploy)

El repo en GitHub solo contiene `backend/`. Los archivos de deploy (`docker-compose.prod.yml`, `nginx/segundo-cerebro.conf`, `.env.prod.template`) están en tu carpeta local `deploy/`. Hay que subirlos al servidor con `scp`:

```bash
# Asegurarse que el directorio existe en el servidor
ssh ubuntu@148.116.110.205 "mkdir -p /home/ubuntu/segundo-cerebro/nginx"

# Subir archivos de deploy
scp deploy/docker-compose.prod.yml ubuntu@148.116.110.205:/home/ubuntu/segundo-cerebro/
scp deploy/nginx/segundo-cerebro.conf ubuntu@148.116.110.205:/home/ubuntu/segundo-cerebro/nginx/
```

### 8.3 En el servidor OCI

```bash
# 1. Entrar al directorio de deploy
cd /home/ubuntu/segundo-cerebro

# 2. Crear .env
cat > .env << 'EOF'
AUTH_TOKEN=<el_mismo_que_en_github_secrets>
OPENAI_API_KEY=<tu_openai_key>
DB_PASSWORD=<password_seguro>
LOG_LEVEL=info
DOCKER_USER=<tu_usuario_dockerhub>
IMAGE_TAG=latest
EOF

# 3. Firebase service account
nano fcm-service-account.json   # pegar el JSON de Firebase

# 4. Levantar todo
docker compose -f deploy/docker-compose.prod.yml up -d

# 5. Verificar
docker compose -f deploy/docker-compose.prod.yml ps
docker compose -f deploy/docker-compose.prod.yml logs backend

# 6. Configurar SSL (si tenés dominio)
sudo certbot --nginx -d segundo-cerebro.tudominio.com

# 7. Probar health
curl https://segundo-cerebro.tudominio.com/health
```

### 8.4 Verificar que funciona

```bash
# Health check
curl https://segundo-cerebro.tudominio.com/health
# {"status":"ok","timestamp":"2026-05-25T..."}

# Logs del backend
docker compose -f docker-compose.prod.yml logs -f backend

# Logs de nginx
docker compose -f docker-compose.prod.yml logs -f nginx
```

Si el health check responde `"status":"ok"`, el backend está corriendo y conectado a PostgreSQL. Si falla, revisar la sección [11. Resolución de problemas](#11-resolución-de-problemas).

---

## 9. Build APK para Android

### 9.1 Fixear permisos faltantes (OBLIGATORIO)

Sin esto, la app no puede grabar audio y crashea al iniciar.

**`appmovil/android/app/src/main/AndroidManifest.xml`** — agregar antes de `<application>`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

**`appmovil/ios/Runner/Info.plist`** — agregar dentro del `<dict>`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Segundo Cerebro necesita acceso al micrófono para escuchar tus comandos de voz</string>
```

> Si no agregás estos permisos, la app no funciona en un dispositivo real.

### 9.2 Configurar URL del servidor

Editar `appmovil/.env`:

```env
WS_URL=wss://segundo-cerebro.tudominio.com/ws
AUTH_TOKEN=<el_mismo_token_del_backend>
```

### 9.3 Build release APK

```bash
cd appmovil

# Asegurarse que el SDK de Flutter está actualizado
flutter doctor

# Build APK release
flutter build apk --release

# El APK se genera en:
# build/app/outputs/flutter-apk/app-release.apk
```

### 9.4 Instalar en el teléfono

**Opción A — ADB (USB)**:

```bash
# Conectar teléfono por USB con debugging USB habilitado
flutter install
```

**Opción B — Compartir archivo**:

- Transferir `build/app/outputs/flutter-apk/app-release.apk` al teléfono (Google Drive, WhatsApp, etc.)
- En el teléfono, abrir el archivo APK
- Aceptar "Instalar apps desconocidas" si es la primera vez

> **Seguridad**: el APK firmado con debug keys solo sirve para uso personal. No lo distribuyas. Para distribución oficial, necesitás [generar un keystore de release](https://docs.flutter.dev/deployment/android#signing-the-app).

---

## 10. Actualizar la app

### 10.1 Backend (automático con CI/CD)

1. Hacer push a `main` en GitHub
2. GitHub Actions corre test → build → deploy automáticamente
3. Verificar con `curl https://segundo-cerebro.tudominio.com/health`

**Rollback manual**:

```bash
# En el servidor OCI
ssh ubuntu@<IP>

cd /home/ubuntu/segundo-cerebro
docker compose -f docker-compose.prod.yml logs backend  # Ver qué tag tiró error

# Si necesitás volver a un tag anterior
export IMAGE_TAG=20260525-120000-abc123def
docker compose -f docker-compose.prod.yml up -d
```

### 10.2 App móvil (manual)

```bash
cd appmovil
git pull origin main
flutter build apk --release
# Instalar el nuevo APK en el teléfono
```

> La app no tiene auto-update. Cada vez que actualices el backend, podés (opcionalmente) rebuildear el APK si hubo cambios en la app.

---

## 11. Resolución de problemas

### Error: `docker compose` no encontrado

```bash
# Instalar Docker Compose plugin
sudo apt install -y docker-compose-plugin
# Verificar
docker compose version
```

### Error: conexión a PostgreSQL rechazada

```bash
# Verificar que postgres está corriendo
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs postgres

# Probar conexión manual
docker compose -f docker-compose.prod.yml exec postgres psql -U segundo_cerebro -d segundo_cerebro -c "SELECT 1"
```

### Error: Certbot no puede validar el dominio

```bash
# Verificar que el puerto 80 está abierto (UFW)
sudo ufw status

# Verificar que nginx está corriendo
sudo systemctl status nginx

# Verificar registro DNS
nslookup segundo-cerebro.tudominio.com
```

### Error: WebSocket no conecta (ERR_CONNECTION_REFUSED)

```bash
# Verificar que el backend está corriendo
docker compose -f docker-compose.prod.yml ps backend

# Verificar health
curl -I https://segundo-cerebro.tudominio.com/health

# Revisar logs de nginx
docker compose -f docker-compose.prod.yml logs nginx
```

### Error: FCM service account no encontrado

```bash
# Verificar que el archivo existe
ls -la /home/ubuntu/segundo-cerebro/fcm-service-account.json

# Si no existe, crearlo
nano /home/ubuntu/segundo-cerebro/fcm-service-account.json
```

### Error: el workflow de GitHub Actions falla en deploy

```bash
# 1. Verificar que los secrets están configurados en GitHub
# 2. Verificar que la clave SSH es válida
ssh -i ~/.ssh/id_rsa ubuntu@<IP>  # debe conectar sin passphrase
# 3. Verificar que Docker está corriendo en el servidor
# 4. Verificar permisos del directorio
ls -la /home/ubuntu/segundo-cerebro/
```

### Error: `biome check` falla (no existe biome.json)

Crear `backend/biome.json`:

```json
{
	"$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
	"organizeImports": {
		"enabled": true
	},
	"linter": {
		"enabled": true,
		"rules": {
			"recommended": true
		}
	},
	"formatter": {
		"enabled": true,
		"indentStyle": "tab",
		"lineWidth": 100
	},
	"javascript": {
		"formatter": {
			"quoteStyle": "double"
		}
	}
}
```

---

## Apéndice A: Comandos útiles

```bash
# Server
docker compose -f docker-compose.prod.yml logs -f -t  # Logs en tiempo real con timestamp
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml down        # Bajar todo
docker compose -f docker-compose.prod.yml pull        # Actualizar imágenes

# Prisma (correr dentro del container)
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec backend npx prisma studio --port 5555

# Postgres
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U segundo_cerebro segundo_cerebro > backup.sql
docker compose -f docker-compose.prod.yml exec postgres psql -U segundo_cerebro -d segundo_cerebro

# Certbot (renovar manual)
sudo certbot renew
```

## Apéndice B: Seguridad

1. **No commitear `.env`** — ya está en `.gitignore`, verificar con `git status`
2. **No exponer el puerto 3000** — solo 443 vía Nginx
3. **PostgreSQL solo localhost** — no expuesto al exterior
4. **Firewall UFW activo** — solo puertos 22, 80, 443
5. **Rotación de tokens** — cambiar `AUTH_TOKEN` periódicamente
6. **SSL/TLS** — Certbot renueva automáticamente cada 90 días
7. **Logs sensibles** — el backend no logea tokens ni transcripciones completas

## Apéndice C: Recursos en OCI Free Tier

| Recurso         | Free Tier disponible | Asignado a este proyecto | Disponible para otros proyectos |
| --------------- | -------------------- | ------------------------ | ------------------------------- |
| OCPU ARM        | 4                    | 2                        | ✅ 2 OCPU                       |
| Memoria RAM     | 24 GB                | 6 GB                     | ✅ 18 GB                        |
| Storage boot    | 200 GB               | ~10 GB                   | ✅ ~190 GB                      |
| Load Balancer   | 1 (10 Mbps)          | No necesario             | ✅ Disponible                   |
| Salida (egress) | 10 TB/mes            | ínfimo                   | ✅ Prácticamente todo           |

El proyecto usa ~2.7 GB de RAM en el peor caso, dejándote **~18 GB libres** para otros proyectos en la misma instancia.

### Cómo correr múltiples proyectos en la misma instancia

Creá una red Docker compartida y anotá los puertos:

```yaml
networks:
  shared-net:
    external: true
```

Cada proyecto usa su propio `docker-compose.yml` con recursos limitados via `deploy.resources`. Los puertos expuestos (80/443) los maneja un solo Nginx que hace reverse proxy a cada proyecto por dominio.
