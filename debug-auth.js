#!/usr/bin/env node

/**
 * Script de diagnóstico para problemas de autenticación OAuth Discord
 * Ayuda a identificar problemas comunes en producción
 */

require('dotenv').config();

console.log('🔍 DIAGNÓSTICO DE AUTENTICACIÓN OAUTH DISCORD');
console.log('='.repeat(50));

// Función para verificar configuración OAuth
function getCallbackURL() {
    if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_URL) {
        return `${process.env.PRODUCTION_URL}/auth/discord/callback`;
    }
    return 'http://localhost:3000/auth/discord/callback';
}

// Variables de entorno críticas
const config = {
    NODE_ENV: process.env.NODE_ENV,
    PRODUCTION_URL: process.env.PRODUCTION_URL,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET ? 'SET' : 'MISSING',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'MISSING'
};

console.log('\n📋 CONFIGURACIÓN ACTUAL:');
console.log(`   Environment: ${config.NODE_ENV || 'development'}`);
console.log(`   Production URL: ${config.PRODUCTION_URL || 'NOT SET'}`);
console.log(`   Discord Client ID: ${config.DISCORD_CLIENT_ID || 'MISSING'}`);
console.log(`   Discord Client Secret: ${config.DISCORD_CLIENT_SECRET}`);
console.log(`   Session Secret: ${config.SESSION_SECRET}`);
console.log(`   Callback URL: ${getCallbackURL()}`);

// Verificar URLs
console.log('\n🔗 VERIFICACIÓN DE URLS:');
const callbackURL = getCallbackURL();
const productionURL = config.PRODUCTION_URL;

if (config.NODE_ENV === 'production') {
    if (!productionURL) {
        console.log('❌ PRODUCTION_URL no está configurada en producción');
    } else if (!productionURL.startsWith('https://')) {
        console.log('⚠️  PRODUCTION_URL debe usar HTTPS en producción');
        console.log(`   Actual: ${productionURL}`);
        console.log(`   Esperada: https://...`);
    } else {
        console.log('✅ PRODUCTION_URL está correctamente configurada');
    }
} else {
    console.log('ℹ️  Modo desarrollo - usando localhost');
}

// Generar URLs para Discord Developer Portal
console.log('\n🔧 CONFIGURACIÓN DISCORD DEVELOPER PORTAL:');
console.log('   Ve a: https://discord.com/developers/applications');
console.log(`   Selecciona tu aplicación (Client ID: ${config.DISCORD_CLIENT_ID})`);
console.log('   En OAuth2 > General > Redirect URIs, agrega:');

if (config.NODE_ENV === 'production' && productionURL) {
    console.log(`   ✅ ${callbackURL}`);
    console.log(`   
   IMPORTANTE: La URL debe ser EXACTA (sin barra final)`);
} else {
    console.log(`   🔧 Para desarrollo: http://localhost:3000/auth/discord/callback`);
    console.log(`   🔧 Para producción: https://tu-app.onrender.com/auth/discord/callback`);
}

// Problemas comunes
console.log('\n⚠️  PROBLEMAS COMUNES:');
const issues = [];

if (!config.DISCORD_CLIENT_ID) {
    issues.push('❌ DISCORD_CLIENT_ID no está configurada');
}

if (config.DISCORD_CLIENT_SECRET === 'MISSING') {
    issues.push('❌ DISCORD_CLIENT_SECRET no está configurada');
}

if (config.NODE_ENV === 'production' && !productionURL) {
    issues.push('❌ PRODUCTION_URL no está configurada para producción');
}

if (productionURL && productionURL.includes('localhost')) {
    issues.push('⚠️  PRODUCTION_URL todavía contiene localhost (¿estás en producción?)');
}

if (callbackURL.endsWith('/')) {
    issues.push('⚠️  Callback URL termina con barra (/) - esto puede causar problemas');
}

if (issues.length === 0) {
    console.log('✅ No se detectaron problemas obvios en la configuración');
} else {
    issues.forEach(issue => console.log(`   ${issue}`));
}

// URLs de prueba
console.log('\n🧪 URLS DE PRUEBA:');
if (config.NODE_ENV === 'production' && productionURL) {
    console.log(`   Inicio de OAuth: ${productionURL}/auth/discord`);
    console.log(`   Callback OAuth: ${callbackURL}`);
    console.log(`   Estado de auth: ${productionURL}/api/auth/status`);
    console.log(`   Frontend: ${productionURL}/`);
} else {
    console.log('   Inicio de OAuth: http://localhost:3000/auth/discord');
    console.log('   Callback OAuth: http://localhost:3000/auth/discord/callback');
    console.log('   Estado de auth: http://localhost:3000/api/auth/status');
    console.log('   Frontend: http://localhost:3000/');
}

// Comandos de depuración
console.log('\n🐛 COMANDOS DE DEPURACIÓN:');
console.log('   npm run verify     # Ejecutar este diagnóstico');
console.log('   npm start          # Iniciar el bot (incluye verificación previa)');
console.log('   npm run dev        # Desarrollo local');

// Checklist final
console.log('\n✅ CHECKLIST FINAL:');
const checklist = [
    '🔐 Variables de entorno configuradas en Render',
    '🌐 PRODUCTION_URL coincide con tu URL de Render',
    '🔗 Redirect URI configurada en Discord Developer Portal',
    '⚡ Bot desplegado y ejecutándose en Render',
    '🔄 Cache del navegador limpiado (Ctrl+F5)',
    '⏰ Esperar 2-3 minutos después de cambios en Discord'
];

checklist.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item}`);
});

console.log('\n🔚 Fin del diagnóstico');
console.log('='.repeat(50));
