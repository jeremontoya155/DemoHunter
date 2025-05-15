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
    defaultMessage: "¡Hola! ¿Estás disponible para una conversación rápida?",
    defaultMessagesVariations: `Variación 1: ¡Hola! ¿Cómo estás?\nVariación 2: Hola, ¿tienes un momento?\nVariación 3: Buen día, ¿podemos hablar?`
  });
});

// Función para obtener un mensaje aleatorio de las variaciones
function getRandomMessage(messagesText) {
  const variations = messagesText.split('\n')
    .map(msg => msg.trim())
    .filter(msg => msg.length > 0 && msg.includes('Variación'));
  
  if (variations.length === 0) return messagesText.split('\n')[0] || messagesText;
  
  const randomIndex = Math.floor(Math.random() * variations.length);
  return variations[randomIndex].replace(/^Variación \d+: /, '');
}

// Ruta para enviar mensajes
app.post('/send', async (req, res) => {
  const { sessionid, users, message, messages_variations } = req.body;
  const userAgent = req.get('User-Agent');
  
  // Validaciones básicas
  if (!sessionid || !users || (!message && !messages_variations)) {
    return res.status(400).send('Faltan campos requeridos');
  }

  const targetAccounts = users.split('\n')
    .map(user => user.trim().replace('@', ''))
    .filter(user => user.length > 0 && user !== '');

  if (targetAccounts.length === 0 || targetAccounts.length > 50) {
    return res.status(400).send('Debes ingresar entre 1 y 50 cuentas');
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
    for (const [index, user] of targetAccounts.entries()) {
      try {
        const userId = await ig.user.getIdByUsername(user);
        
        // Seleccionar mensaje (aleatorio si hay variaciones)
        const finalMessage = messages_variations ? 
          getRandomMessage(messages_variations) : 
          message;
        
        await ig.entity.directThread([userId]).broadcastText(finalMessage);
        results.push({ 
          user, 
          status: 'success', 
          message: 'Mensaje enviado',
          sentMessage: finalMessage
        });
        
        // Delay progresivo más largo para cuentas posteriores
        const baseDelay = 60000; // 1 minuto base
        const progressiveDelay = index * 30000; // 30 segundos adicionales por cuenta
        const randomDelay = Math.random() * 60000; // hasta 1 minuto aleatorio
        
        const totalDelay = baseDelay + progressiveDelay + randomDelay;
        
        console.log(`Enviado a ${user}. Esperando ${Math.round(totalDelay/1000)} segundos...`);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        
      } catch (error) {
        results.push({ 
          user, 
          status: 'error', 
          message: error.message,
          sentMessage: ''
        });
        
        // Delay de seguridad incluso en errores
        await new Promise(resolve => setTimeout(resolve, 30000));
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