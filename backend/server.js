const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

app.get('/ping', (req, res) => {
    res.status(200).send('Pong! El servidor está despierto.');
});

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COOLDOWN_MS = (parseInt(process.env.COOLDOWN_SEGUNDOS) || 15) * 1000;

// Llamada a la API de Telegram (sendMessage, editMessageText, answerCallbackQuery, etc.)
const tg = (metodo, payload) =>
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`, payload);

// Postgres (Supabase). ssl rejectUnauthorized:false porque el pooler usa cert propio.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crea la tabla si no existe. Una fila por cada boton tocado.
async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS solicitudes (
            id BIGSERIAL PRIMARY KEY,
            estado TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT date_trunc('minute', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
        )
    `);
    // RLS on: bloquea la REST API publica de Supabase. El backend usa conexion directa
    // (rol postgres) que igual la bypassea, asi que no afecta el funcionamiento. Idempotente.
    await pool.query('ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY');
    console.log('DB lista (tabla solicitudes)');
}

// ponytail: timestamp en RAM, una sola instancia en Render. Se resetea al reiniciar
// (no pasa nada, el cooldown es efímero). Cuando exista ruteo por pasillo -> Map por pasillo.
let ultimaSolicitud = 0;

app.post('/solicitar', async (req, res) => {
    const ahora = Date.now();
    const restanteMs = COOLDOWN_MS - (ahora - ultimaSolicitud);
    if (restanteMs > 0) {
        return res.status(429).send({
            success: false,
            message: 'Su solicitud ya fue enviada, espere a que se acerque un asesor.',
            esperaSegundos: Math.ceil(restanteMs / 1000)
        });
    }

    try {
        const mensaje = "🔔 *¡Atención!* Un cliente solicita un asesor en Electro.";

        await tg('sendMessage', {
            chat_id: CHAT_ID,
            text: mensaje,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Atendido', callback_data: 'atendido' },
                    { text: '❌ No atendido', callback_data: 'no_atendido' }
                ]]
            }
        });

        ultimaSolicitud = Date.now(); // solo arranca el cooldown si el aviso salió OK
        res.status(200).send({ success: true, message: 'Notificación enviada' });
    } catch (error) {
        console.error('Error enviando mensaje a Telegram:', error.response?.data || error.message);
        res.status(500).send({ success: false, message: 'Error al enviar notificación' });
    }
});

// Procesa un toque de boton: edita el mensaje, saca los botones y registra en la DB.
// Lo usan tanto el webhook (produccion) como el polling (desarrollo local).
async function procesarCallback(cb) {
    const estado = cb.data === 'atendido' ? 'atendido' : 'no_atendido';
    const etiqueta = estado === 'atendido' ? '✅ Solicitud atendida' : '❌ Solicitud no atendida';
    const msg = cb.message;

    // Edita el mensaje y saca los botones (no se puede volver a tocar -> no hay doble conteo)
    try {
        await tg('editMessageText', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            text: etiqueta
        });
    } catch (error) {
        console.error('Error editando mensaje:', error.response?.data || error.message);
    }

    // Registra el evento en la base (en su propio try: si Telegram falla, el dato igual se guarda)
    try {
        await pool.query('INSERT INTO solicitudes (estado) VALUES ($1)', [estado]);
        console.log(`[seguimiento] estado=${estado} guardado en DB`);
    } catch (error) {
        console.error('Error guardando en DB:', error.message);
    }

    // Frena el "relojito" del boton. Cosmetico y best-effort: si falla, no afecta el registro.
    tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
}

// Webhook: Telegram lo llama cuando alguien toca un boton (modo produccion).
app.post('/webhook', (req, res) => {
    res.sendStatus(200); // responder rapido; Telegram reintenta si tarda
    if (req.body.callback_query) procesarCallback(req.body.callback_query);
});

// Polling (modo desarrollo local): el server le pregunta a Telegram por los toques.
// Se activa con USE_POLLING=true en .env. En Render se usa el webhook, no esto.
async function iniciarPolling() {
    await tg('deleteWebhook', {}); // webhook y polling no pueden convivir
    let offset = 0;
    console.log('Modo polling activo (desarrollo local)');
    while (true) {
        try {
            const { data } = await tg('getUpdates', { offset, timeout: 30 });
            for (const u of data.result) {
                offset = u.update_id + 1;
                if (u.callback_query) await procesarCallback(u.callback_query);
            }
        } catch (error) {
            await new Promise(r => setTimeout(r, 2000)); // backoff y reintenta
        }
    }
}

// Estadisticas rapidas: total, atendidas, no atendidas.
app.get('/stats', async (req, res) => {
    try {
        const r = await pool.query('SELECT estado, COUNT(*)::int AS n FROM solicitudes GROUP BY estado');
        const c = { atendido: 0, no_atendido: 0 };
        r.rows.forEach(row => { c[row.estado] = row.n; });
        res.json({ total: c.atendido + c.no_atendido, atendidas: c.atendido, no_atendidas: c.no_atendido });
    } catch (error) {
        console.error('Error en /stats:', error.message);
        res.status(500).json({ error: 'No se pudo leer la base' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    initDb().catch(e => console.error('Error inicializando DB:', e.message));
    if (process.env.USE_POLLING === 'true') {
        iniciarPolling().catch(e => console.error('Error en polling:', e.message));
    }
});
