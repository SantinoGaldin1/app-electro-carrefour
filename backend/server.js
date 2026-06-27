const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
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
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;         // grupo (notificaciones)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || CHAT_ID; // chat privado (panel)
const COOLDOWN_MS = (parseInt(process.env.COOLDOWN_SEGUNDOS) || 15) * 1000;

// Llamada a la API de Telegram (sendMessage, editMessageText, answerCallbackQuery, etc.)
const tg = (metodo, payload) =>
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`, payload);

// Postgres (Supabase). ssl rejectUnauthorized:false porque el pooler usa cert propio.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS solicitudes (
            id BIGSERIAL PRIMARY KEY,
            estado TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT date_trunc('minute', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);
    await pool.query('ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY');
    // Leer estado persistido; si no existe, inicializar según horario
    const saved = await getConfig('servidor_abierto');
    if (saved !== null) {
        servidorAbierto = saved === '1';
    }
    console.log('DB lista');
}

async function getConfig(key) {
    const r = await pool.query('SELECT value FROM config WHERE key = $1', [key]);
    return r.rows[0]?.value ?? null;
}

async function setConfig(key, value) {
    await pool.query(
        'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, value]
    );
}

// ponytail: timestamp en RAM, una sola instancia en Render. Se resetea al reiniciar
// (no pasa nada, el cooldown es efímero). Cuando exista ruteo por pasillo -> Map por pasillo.
let ultimaSolicitud = 0;

function minutosAR() {
    const ar = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    return ar.getHours() * 60 + ar.getMinutes();
}

// Opción 2: el interruptor manual manda; el cron solo lo flip en los bordes del horario.
// Persiste en DB para sobrevivir reinicios y múltiples procesos.
let servidorAbierto = minutosAR() >= 8 * 60 && minutosAR() < 21 * 60 + 30;

async function setAbierto(valor) {
    servidorAbierto = valor;
    await setConfig('servidor_abierto', valor ? '1' : '0');
}

// --- Panel de control (mensaje fijado en chat privado) ---

function textoPanel() {
    const estado = servidorAbierto ? '🟢 *Abierto*' : '🔴 *Cerrado*';
    const ar = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const hora = ar.toTimeString().slice(0, 5);
    return `🏪 *Panel Electro*\n\nEstado: ${estado}\nHorario: 08:00 – 21:30\nÚltima actualización: ${hora} hs`;
}

function tecladoPanel() {
    return {
        inline_keyboard: [[
            { text: '🟢 Abrir', callback_data: 'cmd_abrir' },
            { text: '🔴 Cerrar', callback_data: 'cmd_cerrar' }
        ]]
    };
}

async function actualizarPanel() {
    try {
        const msgId = await getConfig('pinned_msg_id');
        if (!msgId) return;
        console.log(`[panel] editando msg ${msgId} en chat ${ADMIN_CHAT_ID}`);
        await tg('editMessageText', {
            chat_id: ADMIN_CHAT_ID,
            message_id: parseInt(msgId),
            text: textoPanel(),
            parse_mode: 'Markdown',
            reply_markup: tecladoPanel()
        });
        console.log('[panel] mensaje actualizado OK');
    } catch (e) {
        const desc = e.response?.data?.description || e.message;
        console.error('[panel] Error actualizando:', desc);
        // Si el mensaje no existe o el chat cambió, limpiar para que iniciarPanel lo recree
        if (desc.includes('not found') || desc.includes('chat not found') || desc.includes('CHAT_NOT_FOUND')) {
            await setConfig('pinned_msg_id', '').catch(() => {});
            await iniciarPanel().catch(() => {});
        }
    }
}

async function iniciarPanel() {
    try {
        const msgId = await getConfig('pinned_msg_id');
        if (msgId) {
            await actualizarPanel();
        } else {
            const r = await tg('sendMessage', {
                chat_id: ADMIN_CHAT_ID,
                text: textoPanel(),
                parse_mode: 'Markdown',
                reply_markup: tecladoPanel()
            });
            const id = r.data.result.message_id;
            await tg('pinChatMessage', { chat_id: ADMIN_CHAT_ID, message_id: id, disable_notification: true });
            await setConfig('pinned_msg_id', id.toString());
        }
        console.log('[panel] Panel de control listo');
    } catch (e) {
        console.error('[panel] Error iniciando panel:', e.response?.data || e.message);
    }
}

// Cron: flip automático en bordes de horario + actualiza panel
setInterval(async () => {
    const min = minutosAR();
    if (min === 8 * 60)       { await setAbierto(true);  console.log('[horario] Apertura automática 08:00'); await actualizarPanel(); }
    if (min === 21 * 60 + 30) { await setAbierto(false); console.log('[horario] Cierre automático 21:30');  await actualizarPanel(); }
}, 60000);

// --- Rutas ---

app.get('/estado', async (req, res) => {
    const saved = await getConfig('servidor_abierto').catch(() => null);
    if (saved !== null) servidorAbierto = saved === '1';
    res.json({ abierto: servidorAbierto, horario: { desde: '08:00', hasta: '21:30' } });
});

app.post('/solicitar', async (req, res) => {
    if (!servidorAbierto) {
        return res.status(503).send({ success: false, message: 'Fuera de horario de atención (08:00 – 21:30).' });
    }
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

        ultimaSolicitud = Date.now();
        res.status(200).send({ success: true, message: 'Notificación enviada' });
    } catch (error) {
        console.error('Error enviando mensaje a Telegram:', error.response?.data || error.message);
        res.status(500).send({ success: false, message: 'Error al enviar notificación' });
    }
});

// Procesa un toque de boton: edita el mensaje, saca los botones y registra en la DB.
// Lo usan tanto el webhook (produccion) como el polling (desarrollo local).
async function procesarCallback(cb) {
    // Botones del panel de control
    if (cb.data === 'cmd_abrir' || cb.data === 'cmd_cerrar') {
        tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        await setAbierto(cb.data === 'cmd_abrir');
        console.log(`[panel] ${cb.data} → servidorAbierto=${servidorAbierto}`);
        await actualizarPanel();
        return;
    }

    const estado = cb.data === 'atendido' ? 'atendido' : 'no_atendido';
    const etiqueta = estado === 'atendido' ? '✅ Solicitud atendida' : '❌ Solicitud no atendida';
    const msg = cb.message;

    try {
        await tg('editMessageText', {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            text: etiqueta
        });
    } catch (error) {
        console.error('Error editando mensaje:', error.response?.data || error.message);
    }

    try {
        await pool.query('INSERT INTO solicitudes (estado) VALUES ($1)', [estado]);
        console.log(`[seguimiento] estado=${estado} guardado en DB`);
    } catch (error) {
        console.error('Error guardando en DB:', error.message);
    }

    tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
}

// Webhook: Telegram lo llama cuando alguien toca un boton (modo produccion).
app.post('/webhook', (req, res) => {
    res.sendStatus(200); // responder rapido; Telegram reintenta si tarda
    if (req.body.callback_query) procesarCallback(req.body.callback_query).catch(() => {});
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

// Filtro opcional por mes (YYYY-MM). Devuelve [clausula, params] para la query.
const filtroMes = (mes) =>
    mes ? ["WHERE to_char(created_at, 'YYYY-MM') = $1", [mes]] : ['', []];

// Años con datos, desde el primer año hasta el actual. El mes (1-12) lo arma el front.
// En 2027 va a aparecer 2027 solo, dejando 2026 para ver el historial.
app.get('/stats/anios', async (req, res) => {
    try {
        const actual = "extract(year FROM now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::int";
        const r = await pool.query(`
            SELECT y::int AS anio
            FROM generate_series(
                COALESCE((SELECT extract(year FROM min(created_at))::int FROM solicitudes), ${actual}),
                ${actual}
            ) y
            ORDER BY y DESC
        `);
        res.json(r.rows.map(row => row.anio));
    } catch (error) {
        console.error('Error en /stats/anios:', error.message);
        res.status(500).json({ error: 'No se pudo leer la base' });
    }
});

// Estadisticas rapidas: total, atendidas, no atendidas.
// Opcional ?mes=YYYY-MM (un mes) o ?anio=YYYY (todo el año, para el resumen anual).
app.get('/stats', async (req, res) => {
    let where = '', params = [];
    if (req.query.anio) { where = 'WHERE extract(year FROM created_at) = $1'; params = [parseInt(req.query.anio)]; }
    else { [where, params] = filtroMes(req.query.mes); }
    try {
        const r = await pool.query(`SELECT estado, COUNT(*)::int AS n FROM solicitudes ${where} GROUP BY estado`, params);
        const c = { atendido: 0, no_atendido: 0 };
        r.rows.forEach(row => { c[row.estado] = row.n; });
        res.json({ total: c.atendido + c.no_atendido, atendidas: c.atendido, no_atendidas: c.no_atendido });
    } catch (error) {
        console.error('Error en /stats:', error.message);
        res.status(500).json({ error: 'No se pudo leer la base' });
    }
});

// Estadisticas por dia (grafico de barras). Opcional ?mes=YYYY-MM.
app.get('/stats/por-dia', async (req, res) => {
    const [where, params] = filtroMes(req.query.mes);
    try {
        const r = await pool.query(`
            SELECT created_at::date AS dia,
                   COUNT(*) FILTER (WHERE estado = 'atendido')::int    AS atendidas,
                   COUNT(*) FILTER (WHERE estado = 'no_atendido')::int AS no_atendidas
            FROM solicitudes
            ${where}
            GROUP BY dia
            ORDER BY dia
        `, params);
        res.json(r.rows);
    } catch (error) {
        console.error('Error en /stats/por-dia:', error.message);
        res.status(500).json({ error: 'No se pudo leer la base' });
    }
});

// Estadisticas por mes de un año (grafico de barras del resumen anual).
// Devuelve los 12 meses; los que no tienen actividad vienen en 0.
app.get('/stats/por-mes', async (req, res) => {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    try {
        const r = await pool.query(`
            SELECT to_char(m, 'YYYY-MM') AS mes,
                   COALESCE(a.atendidas, 0)    AS atendidas,
                   COALESCE(a.no_atendidas, 0) AS no_atendidas
            FROM generate_series(make_date($1, 1, 1), make_date($1, 12, 1), interval '1 month') m
            LEFT JOIN (
                SELECT date_trunc('month', created_at) AS mm,
                       COUNT(*) FILTER (WHERE estado = 'atendido')::int    AS atendidas,
                       COUNT(*) FILTER (WHERE estado = 'no_atendido')::int AS no_atendidas
                FROM solicitudes
                WHERE extract(year FROM created_at) = $1
                GROUP BY mm
            ) a ON a.mm = m
            ORDER BY m
        `, [anio]);
        res.json(r.rows);
    } catch (error) {
        console.error('Error en /stats/por-mes:', error.message);
        res.status(500).json({ error: 'No se pudo leer la base' });
    }
});

// Dashboard: pagina con los graficos. Misma origin que la API -> sin CORS.
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    if (process.env.USE_POLLING === 'true') {
        iniciarPolling().catch(e => console.error('Error en polling:', e.message));
    } else {
        const webhookUrl = `https://carrefour-bot.onrender.com/webhook`;
        tg('setWebhook', { url: webhookUrl, allowed_updates: ['callback_query', 'message'] })
            .then(() => console.log('[webhook] Registrado:', webhookUrl))
            .catch(e => console.error('[webhook] Error al registrar:', e.message));
    }
    initDb()
        .then(() => iniciarPanel())
        .catch(e => console.error('Error inicializando:', e.message));
});
