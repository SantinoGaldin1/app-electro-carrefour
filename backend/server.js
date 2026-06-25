const express = require('express');
const axios = require('axios');
const cors = require('cors');
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
        const mensaje = "🔔 *¡Atención!* Un cliente está solicitando un asesor en el sector de Electro.";

        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

        await axios.post(url, {
            chat_id: CHAT_ID,
            text: mensaje,
            parse_mode: 'Markdown'
        });

        ultimaSolicitud = Date.now(); // solo arranca el cooldown si el aviso salió OK
        res.status(200).send({ success: true, message: 'Notificación enviada' });
    } catch (error) {
        console.error('Error enviando mensaje a Telegram:', error.response?.data || error.message);
        res.status(500).send({ success: false, message: 'Error al enviar notificación' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
