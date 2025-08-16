require('dotenv').config();

console.log('🧪 Prueba directa del endpoint de autenticación');
console.log('================================================');

// Simular las variables de entorno críticas
console.log('\n📋 Variables de entorno:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('DISCORD_CLIENT_ID:', process.env.DISCORD_CLIENT_ID ? '✅ Configurada' : '❌ Falta');
console.log('DISCORD_CLIENT_SECRET:', process.env.DISCORD_CLIENT_SECRET ? '✅ Configurada' : '❌ Falta');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? '✅ Configurada' : '❌ Falta');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✅ Configurada' : '❌ Falta');

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');

const app = express();

// Configuración de callback URL
const getCallbackURL = () => {
    if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_URL) {
        return `${process.env.PRODUCTION_URL}/auth/discord/callback`;
    }
    return 'http://localhost:3000/auth/discord/callback';
};

console.log('\n🔧 Configuración OAuth:');
console.log('Callback URL:', getCallbackURL());

// Configuración mínima de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-for-test',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: false, // HTTP para desarrollo
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'discord-auth-session'
}));

// Configurar Passport
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: getCallbackURL(),
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    console.log('✅ Usuario autenticado desde Discord:', profile.username || 'Sin username');
    console.log('🔍 Profile data:', {
        id: profile.id,
        username: profile.username,
        discriminator: profile.discriminator,
        avatar: profile.avatar
    });
    
    const userProfile = {
        id: profile.id,
        username: profile.username || 'Usuario',
        discriminator: profile.discriminator || '0000',
        avatar: profile.avatar,
        accessToken: accessToken
    };
    
    return done(null, userProfile);
}));

passport.serializeUser((user, done) => {
    console.log('📦 Serializando usuario:', user.username);
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    console.log('📦 Deserializando usuario con ID:', id);
    // Simulación simple de user data
    const user = {
        id: id,
        username: 'TestUser',
        discriminator: '0000',
        avatar: null,
        balance: 1000
    };
    done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de debugging
app.use((req, res, next) => {
    console.log(`🌐 ${req.method} ${req.path} - Session ID: ${req.sessionID}`);
    if (req.user) {
        console.log(`   👤 User: ${req.user.username}`);
    } else {
        console.log('   👤 User: Not authenticated');
    }
    next();
});

// Rutas de autenticación
app.get('/auth/discord', (req, res, next) => {
    console.log('🚀 Iniciando autenticación Discord...');
    passport.authenticate('discord')(req, res, next);
});

app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/?error=auth_failed',
        failureMessage: true
    }),
    async (req, res) => {
        try {
            console.log('🔄 Callback de Discord ejecutado');
            if (req.user) {
                console.log('✅ Usuario en callback:', req.user.username);
                res.redirect('/success');
            } else {
                console.log('❌ No hay usuario en req.user');
                res.redirect('/?error=no_user');
            }
        } catch (error) {
            console.error('❌ Error en callback:', error);
            res.redirect('/?error=callback_error');
        }
    }
);

// Endpoint de estado
app.get('/api/auth/status', async (req, res) => {
    console.log('🔍 Verificando estado de autenticación...');
    console.log('   isAuthenticated:', req.isAuthenticated());
    console.log('   req.user:', req.user);
    console.log('   session:', req.session);
    
    if (req.isAuthenticated() && req.user) {
        console.log('✅ Usuario autenticado encontrado:', req.user.id);
        const responseData = {
            authenticated: true,
            user: {
                id: req.user.id,
                username: req.user.username || 'Usuario',
                discriminator: req.user.discriminator || '0000',
                avatar: req.user.avatar,
                balance: 1000
            }
        };
        console.log('📤 Enviando datos de usuario:', responseData);
        res.json(responseData);
    } else { 
        console.log('❌ Usuario no autenticado');
        res.json({ authenticated: false }); 
    }
});

// Página de éxito
app.get('/success', (req, res) => {
    res.send(`
        <h1>¡Autenticación Exitosa!</h1>
        <p>Usuario: ${req.user ? req.user.username : 'Desconocido'}</p>
        <a href="/api/auth/status">Verificar estado de auth</a>
    `);
});

// Página principal
app.get('/', (req, res) => {
    const error = req.query.error;
    let errorMessage = '';
    
    if (error) {
        switch(error) {
            case 'auth_failed':
                errorMessage = '<p style="color: red;">Error en la autenticación con Discord. Inténtalo de nuevo.</p>';
                break;
            case 'no_user':
                errorMessage = '<p style="color: red;">No se pudo obtener la información del usuario de Discord.</p>';
                break;
            case 'callback_error':
                errorMessage = '<p style="color: red;">Error en el proceso de autenticación. Inténtalo de nuevo.</p>';
                break;
        }
    }
    
    res.send(`
        <h1>Prueba de Autenticación Discord</h1>
        ${errorMessage}
        <p>Estado: ${req.isAuthenticated() ? 'Autenticado' : 'No autenticado'}</p>
        ${req.user ? `<p>Usuario: ${req.user.username}</p>` : ''}
        <a href="/auth/discord" style="padding: 10px 20px; background: #7289da; color: white; text-decoration: none; border-radius: 5px;">Iniciar Sesión con Discord</a>
        <br><br>
        <a href="/api/auth/status">Verificar estado de auth (JSON)</a>
    `);
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor de prueba ejecutándose en puerto ${PORT}`);
    console.log(`📱 Abre: http://localhost:${PORT}`);
    console.log('🔗 Para probar autenticación, haz clic en "Iniciar Sesión con Discord"');
    console.log('\n⚠️  IMPORTANTE: Asegúrate de que en Discord Developer Portal tengas:');
    console.log(`   http://localhost:${PORT}/auth/discord/callback`);
});
