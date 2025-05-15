require('dotenv').config();
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Configuración de delays (aumentados para mayor seguridad)
const DELAY_CONFIG = {
  base: 90000,        // 1.5 minutos base
  increment: 45000,    // 45 segundos adicionales por cuenta
  random: 90000,       // hasta 1.5 minutos aleatorios
  error: 120000        // 2 minutos en errores
};

// Lista de proxies (puede estar vacía)
const PROXY_LIST = process.env.PROXY_LIST ? 
  process.env.PROXY_LIST.split(',') : [];

// Ruta principal (manteniendo tu frontend)
app.get('/', (req, res) => {
  res.render('index', { 
    defaultMessage: "¡Hola! ¿Estás disponible para una conversación rápida?",
    defaultMessagesVariations: `Variación 1: ¡Hola! ¿Cómo estás?\nVariación 2: Hola, ¿tienes un momento?\nVariación 3: Buen día, ¿podemos hablar?`,
    proxyList: PROXY_LIST.join('\n')
  });
});

// Función para obtener mensaje aleatorio (mejorada)
function getRandomMessage(messagesText) {
  const lines = messagesText.split('\n')
    .map(msg => msg.trim())
    .filter(msg => msg.length > 0);

  // Soporta tanto "Variación X:" como mensajes directos
  const variations = lines.map(line => 
    line.replace(/^Variación \d+: /, '')
  );
  
  return variations[Math.floor(Math.random() * variations.length)];
}

// Función para rotar proxies (optimizada)
function getProxyForCount(accountCount, proxyList) {
  if (!proxyList || proxyList.length === 0) return null;
  const proxyIndex = Math.floor(accountCount / 5) % proxyList.length;
  return proxyList[proxyIndex];
}

// Ruta para enviar mensajes (con mejoras de seguridad)
app.post('/send', async (req, res) => {
  const { sessionid, users, message, messages_variations, proxies } = req.body;
  
  // Validaciones mejoradas
  if (!sessionid?.trim() || !users?.trim()) {
    return res.status(400).render('results', { 
      error: 'Session ID y lista de usuarios son requeridos'
    });
  }

  if (!message?.trim() && !messages_variations?.trim()) {
    return res.status(400).render('results', { 
      error: 'Debes proporcionar un mensaje o variaciones'
    });
  }

  const targetAccounts = users.split('\n')
    .map(user => user.trim().replace('@', ''))
    .filter(user => {
      // Validación más estricta de usernames
      return user.length > 0 && 
             user.length <= 30 && 
             /^[a-zA-Z0-9._]+$/.test(user);
    });

  if (targetAccounts.length === 0 || targetAccounts.length > 30) {
    return res.status(400).render('results', { 
      error: 'Debes ingresar entre 1 y 30 cuentas válidas'
    });
  }

  // Procesar proxies (con validación mejorada)
  const activeProxies = proxies.split('\n')
    .map(proxy => proxy.trim())
    .filter(proxy => {
      if (!proxy) return false;
      try {
        new URL(proxy); // Validación básica de URL
        return true;
      } catch {
        return false;
      }
    });
  
  const proxyList = activeProxies.length > 0 ? activeProxies : PROXY_LIST;

  const ig = new IgApiClient();
  const sessionFile = `sessions/session_${uuid.v4()}.json`;

  try {
    // Configuración de dispositivo y sesión más segura
    ig.state.generateDevice(sessionid);
    await ig.state.deserializeCookieJar(JSON.stringify({
      cookies: [{
        key: 'sessionid',
        value: sessionid,
        domain: 'instagram.com',
        secure: true,
        path: '/',
        httponly: true
      }]
    }));

    // Simular actividad humana antes de empezar
    await new Promise(resolve => setTimeout(resolve, 15000));

    const currentUser = await ig.account.currentUser();
    const results = [];
    let currentProxy = null;

    for (const [index, user] of targetAccounts.entries()) {
      try {
        // Rotación de proxy cada 5 cuentas (si hay proxies)
        if (index % 5 === 0) {
          currentProxy = getProxyForCount(index, proxyList);
          if (currentProxy) {
            ig.request.defaults.agent = new SocksProxyAgent(currentProxy);
            console.log(`Rotando a proxy: ${currentProxy}`);
            // Delay adicional al cambiar proxy
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }

        // Delay inteligente (más largo que antes)
        const delay = DELAY_CONFIG.base + 
                     (index * DELAY_CONFIG.increment) + 
                     (Math.random() * DELAY_CONFIG.random);
        
        console.log(`Delay configurado: ${Math.round(delay/1000)}s para ${user}`);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Obtener user ID y mensaje
        const userId = await ig.user.getIdByUsername(user);
        const finalMessage = messages_variations ? 
          getRandomMessage(messages_variations) : 
          message;
        
        // Envío seguro con manejo de errores específico
        await ig.entity.directThread([userId]).broadcastText(finalMessage);
        
        results.push({ 
          user, 
          status: 'success', 
          sentMessage: finalMessage,
          proxyUsed: currentProxy || 'Directo',
          delayUsed: `${Math.round(delay/1000)}s`
        });

      } catch (error) {
        const errorMsg = error.message.includes('wait') ? 
          'Límite de frecuencia - aumentar delays' :
          error.message;
        
        results.push({ 
          user, 
          status: 'error', 
          message: errorMsg,
          proxyUsed: currentProxy || 'Directo'
        });
        
        // Delay extendido en errores
        await new Promise(resolve => setTimeout(resolve, DELAY_CONFIG.error));
        
        // Si es error de límite, detener el proceso
        if (error.message.includes('wait')) break;
      }
    }

    // Resultados con más información
    res.render('results', { 
      username: currentUser.username,
      results,
      totalAccounts: targetAccounts.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'error').length
    });

  } catch (error) {
    console.error('Error general:', error);
    res.status(500).render('results', { 
      error: `Error crítico: ${error.message}`,
      recommendation: 'Verifica tu Session ID y conexión'
    });
  } finally {
    // Limpieza segura
    if (fs.existsSync(sessionFile)) {
      try {
        fs.unlinkSync(sessionFile);
      } catch (cleanError) {
        console.error('Error limpiando sesión:', cleanError);
      }
    }
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor seguro corriendo en http://localhost:${PORT}`);
  if (!fs.existsSync('sessions')) {
    fs.mkdirSync('sessions');
  }
});