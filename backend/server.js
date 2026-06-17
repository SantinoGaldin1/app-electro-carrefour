const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.post('/solicitar', async (req, res) => {
    try {
        const mensaje = "🔔 *¡Atención!* Un cliente está solicitando un asesor en el sector de Electro.";
        
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: mensaje,
            parse_mode: 'Markdown'
        });

        res.status(200).send({ success: true, message: 'Notificación enviada' });
    } catch (error) {
        console.error('Error enviando mensaje a Telegram:', error.response?.data || error.message);
        res.status(500).send({ success: false, message: 'Error al enviar notificación' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
