# Aplicación Solicitar Asesor - Carrefour Electro

Esta aplicación permite a los clientes solicitar asistencia escaneando un código QR. La notificación llega a un grupo de Telegram donde están los 4 asesores.

## 1. Configuración de Telegram (Para todo el equipo)

1. **Crear el Bot:**
   - Busca a `@BotFather` en Telegram y crea un bot con `/newbot`. Guarda el **API Token**.
2. **Crear el Grupo:**
   - Crea un grupo de Telegram e invita a tus 3 compañeros.
   - **IMPORTANTE:** Agrega al Bot que creaste como miembro del grupo.
3. **Obtener el Group Chat ID:**
   - Agrega al bot `@raw_data_bot` al grupo.
   - Apenas entre, enviará un mensaje con mucha información técnica. Busca la sección `"chat": { "id": -100XXXXXXXXXX }`. Ese número negativo es el **Chat ID del grupo**.
   - (Luego puedes sacar a `@raw_data_bot`).

## 2. Despliegue en Render (Gratis y 24/7)

Para que funcione con 4G/5G, subiremos el backend a **Render.com**:

1. Sube tu código a un repositorio de **GitHub**.
2. Crea una cuenta en [Render.com](https://render.com/).
3. Haz clic en **New +** > **Web Service**.
4. Conecta tu repo de GitHub.
5. En la configuración:
   - **Runtime:** `Node`
   - **Build Command:** `npm install` (asegúrate de que sea en la carpeta backend)
   - **Start Command:** `node server.js`
6. Ve a la pestaña **Environment** y agrega:
   - `TELEGRAM_BOT_TOKEN`: (Tu token)
   - `TELEGRAM_CHAT_ID`: (Tu ID de grupo negativo)
7. Render te dará una URL (ej: `https://app-electro.onrender.com`).

## 3. Actualizar el Frontend

Una vez tengas la URL de Render:
1. Abre `frontend/index.html`.
2. Cambia `http://localhost:3000/solicitar` por `https://tu-url-de-render.onrender.com/solicitar`.
3. ¡Listo! Ya puedes generar el QR con esa URL (o subir el HTML a GitHub Pages/Vercel si quieres que la web también esté en la nube).
