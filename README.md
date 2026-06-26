# Solicitar Asesor — Carrefour Electro

Aplicación web para que un cliente del sector de Electrodomésticos pueda **llamar a un asesor con un solo botón**. La solicitud llega al instante a un grupo de Telegram donde están los asesores, que pueden marcarla como atendida o no atendida desde el mismo mensaje. Todo el seguimiento queda registrado y se visualiza en un dashboard.

## El problema que resuelve

En el sector de Electro los asesores no siempre están cerca del punto de venta (están reponiendo, ayudando en otro pasillo, etc.). El cliente que necesita ayuda no tiene forma de avisar. Esta app le da un botón: lo toca y un asesor recibe el aviso en su celular, sin importar dónde esté en el local.

## Cómo funciona

1. El cliente abre la página (por ejemplo desde un QR en el sector) y toca **Solicitar**.
2. El backend recibe el pedido y envía un mensaje al **grupo de Telegram** de los asesores, con dos botones: **✅ Atendido** y **❌ No atendido**.
3. Un asesor toca uno de los botones. El mensaje se actualiza ("Solicitud atendida" / "no atendida") y los botones desaparecen, así no se cuenta dos veces.
4. Cada resultado se guarda en una base de datos.
5. El **dashboard** muestra las estadísticas: cuántas solicitudes hubo, cuántas se atendieron y cuántas no, por día, por mes o como resumen anual.

Incluye un **cooldown** para que tocar el botón muchas veces seguidas no genere un spam de notificaciones.

## Dashboard

Página de estadísticas con gráficos (torta de atendidas/no atendidas y barras por día o por mes), filtros por año y mes, un modo "Resumen de año" y auto-actualización cuando entra una solicitud nueva.

## Arquitectura

```
Cliente (navegador)
      │  toca "Solicitar"
      ▼
Frontend  ── GitHub Pages
      │  HTTP
      ▼
Backend (API)  ── Render
      │           ├─► Telegram Bot API  (mensaje + botones)
      │           └─► PostgreSQL ── Supabase  (registro de cada solicitud)
      ▼
Dashboard  (servido por el backend)
```

- **Frontend** y **backend** están desacoplados: la web es estática y la API corre aparte.
- El backend recibe los toques de los botones de Telegram mediante un **webhook**.
- Un **cron-job** le hace un ping periódico al backend para mantenerlo despierto: el plan gratuito de Render "duerme" el servicio tras un tiempo de inactividad, y el ping evita la demora del primer arranque (cold start), así el webhook y las solicitudes responden al instante.

## Tecnologías

| Capa | Herramienta |
|------|-------------|
| Frontend | [Vite](https://vite.dev/) + HTML/CSS/JS, alojado en [GitHub Pages](https://pages.github.com/) |
| Backend | [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) en [Render](https://render.com/) |
| Mensajería | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Base de datos | [PostgreSQL](https://www.postgresql.org/) en [Supabase](https://supabase.com/) |
| Gráficos | [Chart.js](https://www.chartjs.org/) |
| CI/CD | [GitHub Actions](https://github.com/features/actions) (build + deploy automático) |

## Estructura del repositorio

```
frontend/   Página del cliente (Vite). Se publica en GitHub Pages.
backend/    API en Express: envío a Telegram, webhook, base de datos y dashboard.
.github/    Workflows de CI y de deploy a Pages.
```

## Estado

Aplicación en uso real en el sector de Electrodomésticos. Mejoras posibles a futuro: ruteo de solicitudes por pasillo y protección de acceso al dashboard.
