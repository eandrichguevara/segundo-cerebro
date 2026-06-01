# 🤖 Agent Context & Memory (Proyecto: Dashboard Web)

## 🎯 Objetivo del Proyecto

Dashboard web de lectura del ecosistema "Segundo Cerebro". Renderiza datos del backend (tareas, objetivos, listas, eventos, proyectos, ideas, memorias, conversaciones, jobs, dispositivos, enlaces) con Next.js SSR y shadcn/base-ui. Es solo visualización; toda la lógica de negocio y escritura vive en el backend.

## 🛠️ Stack Tecnológico & Restricciones

- **Lenguaje/Entorno:** Node.js v22 (TypeScript 5, strict mode)
- **Framework Principal:** Next.js 16.2.6 (App Router, `output: "standalone"`)
- **UI:** React 19, shadcn/base-ui, Tailwind CSS v4, lucide-react
- **Package Manager:** `pnpm` exclusivamente (v10.8.0)
- **Estilo:** dark theme, oklch, paleta púrpura (`oklch(0.68 0.22 295)`), emojis como iconos de estado
- **Lint:** ESLint v9 con `eslint-config-next`
- **Testing:** Sin framework definido aún
- **Despliegue:** Docker multi-stage (node:22-alpine), puerto 3001

## 📐 Arquitectura Propuesta

- **Ruteo:** Next.js App Router, todas las páginas con `force-dynamic` (SSR, sin generación estática ni ISR)
- **Patrón:** Server Components + API client centralizado (`src/lib/api.ts`)
- **Layout:** Sidebar persistente con 12 ítems de navegación, tipografía Geist Sans + Geist Mono
- **13 rutas:**
  - `/` — Dashboard (Quick Memory: whoAmI, dataClave, todayContext, recentTopics)
  - `/tasks`, `/objectives`, `/events`, `/lists`, `/memories`, `/conversations`, `/jobs`, `/projects`, `/ideas`, `/devices`, `/entity-links` — Páginas de entidad
- **API Client único** en `src/lib/api.ts`: se comunica con backend Fastify (puerto 3000, configurable via `API_URL`)
- **Componentes:** UI primitives con shadcn/base-ui (`card`, `badge`, `button`, `separator`), componentes específicos por entidad (tablas, cards, timeline)
- **Estados visuales:** loading, empty (`empty-state.tsx`), error (`error-state.tsx`), success en todas las páginas
- **Sin autenticación** (dashboard interno, backend no expuesto públicamente)

## 🚦 Estado Actual e Hitos de Automatización

- [x] Inicialización del proyecto Next.js 16 + shadcn/base-ui + Tailwind v4
- [x] Layout base con sidebar y dark theme
- [x] Dashboard (/) con Quick Memory view (whoAmI, dataClave, todayContext, recentTopics, summary cards)
- [x] Páginas de entidad: tasks, objectives, events, lists, memories, conversations, jobs, projects, ideas, devices, entity-links
- [x] Componentes de visualización: `task-table`, `objective-cards`, `event-timeline`, `list-cards` (cliente), `project-table`, `idea-table`, `device-table`, `entity-link-table`
- [x] Componentes de estado: `empty-state`, `error-state`, `section-header`, `status-header`, `sidebar`
- [x] Componentes dashboard: `summary-cards`, `whoami-card`, `data-clave-grid`, `today-section`, `topics-section`
- [x] API client (`fetchQuickMemory`, `fetchDbData`, `fetchAllEntityCounts`)
- [x] Dockerfile multi-stage (standalone)
- [x] Configuración ESLint + PostCSS + TypeScript strict
- [ ] Suite de pruebas unitarias/integración (Vitest o Playwright)
- [ ] Manejo de estados de carga skeleton
- [ ] Paginación en tablas grandes (+50 registros)
- [ ] Filtros avanzados por rango de fechas

## 📌 Reglas Generales para el Agente (Modo Build)

1. **Linter**: Ejecutar `pnpm lint` antes de dar un cambio por terminado. No introducir nuevos warnings ni errores.
2. **Commits**: Usar `git commit -m "tipo(web): mensaje"` siguiendo Conventional Commits.
3. **TypeScript**: Mantener strict mode. No usar `any`, `as unknown as T`, `!` (non-null assertion), ni `@ts-ignore`.
4. **Imports**: Orden: externos → `@/*` → relativos. Separar con línea en blanco.
5. **Componentes**: Un archivo por componente. Nombres en PascalCase. Archivos en kebab-case.
6. **Estilo**: Usar Tailwind CSS v4 con sintaxis `@import "tailwindcss"`. No CSS modules ni styled-components.
7. **Datos**: Toda la data se obtiene vía SSR con `fetch` desde el backend. No hay mutaciones desde el web.
8. **Emojis**: Usar emojis para estados, badges e indicadores (🔴🟡🟢⏳🔄✅☐☑📅🎯🧠), consistente con el resto del ecosistema.
9. **Librerías externas**: No agregar sin consultar. Preferir shadcn/base-ui para nuevos componentes UI.
10. **Testing**: Cuando se implementen tests, usar Vitest. Prioridad: componentes de UI → páginas → API client.
11. **Next.js 16**: Consultar `node_modules/next/dist/docs/` antes de escribir código si hay dudas sobre APIs o convenciones. Este proyecto usa una versión bleeding-edge con breaking changes.
12. **Debugging**: Si una página no renderiza, verificar que el backend esté corriendo (puerto 3000) y que `API_URL` esté configurada en `.env.local`.
