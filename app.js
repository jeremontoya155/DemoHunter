require('dotenv').config();
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.render('index', { 
    defaultMessage: "¡Hola! ¿Estás disponible para una conversación rápida?" 
  });
});

// Ruta para enviar mensajes
app.post('/send', async (req, res) => {
  const { sessionid, users, message } = req.body;
  const userAgent = req.get('User-Agent');
  
  // Validaciones básicas
  if (!sessionid || !users || !message) {
    return res.status(400).send('Faltan campos requeridos');
  }

  const targetAccounts = users.split('\n')
    .map(user => user.trim().replace('@', ''))
    .filter(user => user.length > 0 && user !== '');

  if (targetAccounts.length === 0 || targetAccounts.length > 10) {
    return res.status(400).send('Debes ingresar entre 1 y 10 cuentas');
  }

  // Crear instancia única para este usuario
  const ig = new IgApiClient();
  const sessionFile = `sessions/session_${uuid.v4()}.json`;

  try {
    // Configurar dispositivo y sesión
    ig.state.generateDevice(sessionid);
    await ig.state.deserializeCookieJar(JSON.stringify({
      cookies: [{
        key: 'sessionid',
        value: sessionid,
        domain: 'instagram.com',
        secure: true,
        path: '/'
      }]
    }));

    // Verificar sesión
    const currentUser = await ig.account.currentUser();
    const results = [];

    // Procesar cada cuenta
    for (const user of targetAccounts) {
      try {
        const userId = await ig.user.getIdByUsername(user);
        await ig.entity.directThread([userId]).broadcastText(message);
        results.push({ user, status: 'success', message: 'Mensaje enviado' });
        
        // Delay aleatorio entre 30-90 segundos
        const delayTime = 30000 + Math.random() * 60000;
        await new Promise(resolve => setTimeout(resolve, delayTime));
      } catch (error) {
        results.push({ user, status: 'error', message: error.message });
      }
    }

    // Renderizar resultados
    res.render('results', { 
      username: currentUser.username,
      results,
      messageSent: message
    });

  } catch (error) {
    console.error('Error general:', error);
    res.status(500).render('results', { 
      error: `Error al procesar la solicitud: ${error.message}`
    });
  } finally {
    // Limpiar archivo de sesión si existe
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  if (!fs.existsSync('sessions')) {
    fs.mkdirSync('sessions');
  }
});