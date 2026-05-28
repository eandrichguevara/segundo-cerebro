# Setup de Infraestructura en OCI — Segundo Cerebro

## Paso 1: Crear la Instancia Compute (ARM64)

1. Ir a **Oracle Cloud Console** → **Compute** → **Instances** → **Create Instance**.
2. Nombre: `segundo-cerebro`
3. Placement: seleccionar AD que tenga **Always Free** disponible.
4. Image: **Canonical Ubuntu 22.04** (o 24.04 si está disponible para ARM).
5. Shape: **VM.Standard.A1.Flex**
   - OCPU: **4**
   - Memory: **24 GB**
6. Networking: crear o usar VCN por defecto.
7. Add SSH keys: subir tu clave pública SSH.
8. Presionar **Create**.
9. Una vez creada, copiar la **Public IP Address** (ej: `152.67.XX.XX`).

## Paso 2: Abrir Puertos (Security List)

En la VCN asociada a la instancia, agregar reglas en la **Security List**:

| State    | Source      | Protocol | Ports | Description           |
| -------- | ----------- | -------- | ----- | --------------------- |
| Stateful | `0.0.0.0/0` | TCP      | 22    | SSH                   |
| Stateful | `0.0.0.0/0` | TCP      | 80    | HTTP (Certbot)        |
| Stateful | `0.0.0.0/0` | TCP      | 443   | HTTPS (Nginx)         |
| Stateful | `0.0.0.0/0` | TCP      | 3000  | Fastify (dev/testing) |

> El puerto 3000 es para testing directo. En producción solo se expone 443 vía Nginx reverse proxy.

## Paso 3: Configurar DNS en HostGator

1. Ir al portal de HostGator → cPanel → Zone Editor (o DNS Manager).
2. Seleccionar `milo-apps.com`.
3. Crear un registro **A**:
   - **Name**: `segundo-cerebro`
   - **Points to**: `<IP_PÚBLICA_DE_OCI>`
   - **TTL**: 600 (10 min)
4. Guardar. La propagación toma 5–15 minutos.

## Paso 4: Conectarse por SSH

```bash
chmod 600 /ruta/a/tu-clave.pem
ssh -i /ruta/a/tu-clave.pem ubuntu@<IP_PÚBLICA_DE_OCI>
```

## Paso 5: Instalar Dependencias Base

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential nginx certbot python3-certbot-nginx ufw
```

## Paso 6: Instalar PostgreSQL 16 + pgvector

```bash
# Agregar repositorio oficial de PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16 postgresql-contrib-16 postgresql-server-dev-16

# Compilar e instalar pgvector para ARM64
cd /tmp
git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Crear base de datos y usuario
sudo -u postgres psql -c "CREATE USER segundo_cerebro WITH PASSWORD 'cambiar_esto_por_password_seguro';"
sudo -u postgres psql -c "CREATE DATABASE segundo_cerebro OWNER segundo_cerebro;"
sudo -u postgres psql -d segundo_cerebro -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Verificar instalación
sudo -u postgres psql -d segundo_cerebro -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

## Paso 7: Asegurar PostgreSQL (local)

Editar `/etc/postgresql/16/main/postgresql.conf`:

```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
```

Buscar `listen_addresses` y cambiarlo a:

```conf
listen_addresses = 'localhost'
```

Reiniciar PostgreSQL:

```bash
sudo systemctl restart postgresql
```

## Paso 8: Instalar Node.js 20 + pnpm

```bash
# Usar nvm para Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v   # Debe mostrar v22.x

# pnpm via corepack
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v   # Debe mostrar la versión
```

## Paso 9: Configurar Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status verbose
```

## Paso 10: Configurar Nginx + Certbot (SSL)

Crear `/etc/nginx/sites-available/segundo-cerebro`:

```nginx
server {
    listen 80;
    server_name segundo-cerebro.milo-apps.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Activar el sitio y verificar:

```bash
sudo ln -s /etc/nginx/sites-available/segundo-cerebro /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Obtener certificado SSL (sigue las instrucciones interactivas):

```bash
sudo certbot --nginx -d segundo-cerebro.milo-apps.com
```

Verificar renovación automática:

```bash
sudo certbot renew --dry-run
```

## Paso 11: Preparar Variables de Entorno

Crear `/home/ubuntu/segundo-cerebro/backend/.env` (cuando el proyecto esté desplegado):

```bash
DATABASE_URL="postgresql://segundo_cerebro:cambiar_esto_por_password_seguro@localhost:5432/segundo_cerebro?schema=public"
AUTH_TOKEN="generar_un_token_muy_largo_y_seguro_aqui"
PORT=3000
NODE_ENV=production
```

> Las claves de integraciones (Deepgram, Groq, OpenAI, ElevenLabs) se agregan a este mismo archivo más adelante.

## Paso 12: Resumen de Acceso

| Recurso        | URL / Comando                                    |
| -------------- | ------------------------------------------------ |
| Aplicación     | `https://segundo-cerebro.milo-apps.com`          |
| SSH            | `ssh -i tu-clave.pem ubuntu@<IP_PÚBLICA>`        |
| PostgreSQL     | `sudo -u postgres psql -d segundo_cerebro`       |

## Notas Finales

- Los puertos 80 y 443 están abiertos al público. El puerto 3000 solo para debugging temporal; una vez que Nginx funcione, cerrarlo en el Security List.
- PostgreSQL escucha solo en localhost (puerto 5432) — no expuesto al exterior.
- La contraseña de PostgreSQL debe cambiarse por una segura y reflejarse en `DATABASE_URL` del backend.
- Si la IP pública cambia tras reinicio, actualizar el registro A en HostGator y re-ejecutar Certbot.
