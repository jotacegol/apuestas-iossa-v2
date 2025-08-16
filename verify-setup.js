#!/usr/bin/env node

/**
 * Script de verificación para el bot de apuestas IOSoccer
 * Verifica que todas las variables de entorno y configuraciones estén correctas
 */

require('dotenv').config();

console.log('🔍 Verificando configuración del bot...\n');

// Variables de entorno requeridas
const requiredEnvVars = {
    'BOT_TOKEN': process.env.BOT_TOKEN,
    'DISCORD_CLIENT_ID': process.env.DISCORD_CLIENT_ID,
    'DISCORD_CLIENT_SECRET': process.env.DISCORD_CLIENT_SECRET,
    'MONGODB_URI': process.env.MONGODB_URI,
    'SESSION_SECRET': process.env.SESSION_SECRET,
    'PRODUCTION_URL': process.env.PRODUCTION_URL,
    'NODE_ENV': process.env.NODE_ENV
};

let allValid = true;

console.log('📋 Variables de entorno:');
for (const [key, value] of Object.entries(requiredEnvVars)) {
    const isRequired = key !== 'PRODUCTION_URL' && key !== 'NODE_ENV';
    
    if (!value && isRequired) {
        console.log(`❌ ${key}: FALTANTE (REQUERIDA)`);
        allValid = false;
    } else if (!value) {
        console.log(`⚠️  ${key}: No definida (opcional)`);
    } else {
        // Mostrar solo los primeros caracteres para seguridad
        const maskedValue = key.includes('SECRET') || key.includes('TOKEN') 
            ? `${value.substring(0, 8)}...` 
            : value;
        console.log(`✅ ${key}: ${maskedValue}`);
    }
}

console.log('\n🔧 Configuración OAuth Discord:');
const callbackURL = process.env.NODE_ENV === 'production' && process.env.PRODUCTION_URL
    ? `${process.env.PRODUCTION_URL}/auth/discord/callback`
    : 'http://localhost:3000/auth/discord/callback';

console.log(`   - Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   - Callback URL: ${callbackURL}`);

console.log('\n📦 Dependencias:');
try {
    const packageJson = require('./package.json');
    const requiredDeps = [
        'discord.js', 'express', 'mongoose', 'passport', 'passport-discord',
        'socket.io', 'axios', 'cheerio', 'cors', 'express-session', 'cookie-parser'
    ];
    
    for (const dep of requiredDeps) {
        if (packageJson.dependencies[dep]) {
            console.log(`✅ ${dep}: ${packageJson.dependencies[dep]}`);
        } else {
            console.log(`❌ ${dep}: FALTANTE`);
            allValid = false;
        }
    }
} catch (error) {
    console.log('❌ Error leyendo package.json:', error.message);
    allValid = false;
}

console.log('\n📁 Archivos requeridos:');
const requiredFiles = [
    'bot.js',
    'package.json',
    '.env',
    'public/index.html',
    'public/script.js',
    'public/style.css',
    'render.yaml'
];

const fs = require('fs');
for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file}: FALTANTE`);
        allValid = false;
    }
}

console.log('\n📊 Resumen:');
if (allValid) {
    console.log('🎉 ¡Configuración completa! El bot está listo para desplegarse.');
    console.log('\n📝 Próximos pasos para Render:');
    console.log('   1. Asegúrate de que PRODUCTION_URL en .env coincida con tu URL de Render');
    console.log('   2. En la configuración de Discord Developer Portal:');
    console.log(`      - Redirect URI: ${callbackURL.replace('localhost:3000', 'tu-app-render.onrender.com')}`);
    console.log('   3. Configura las variables de entorno en Render');
    console.log('   4. ¡Despliega tu bot!');
} else {
    console.log('❌ Faltan configuraciones. Revisa los errores arriba.');
    process.exit(1);
}

console.log('\n🔗 Enlaces útiles:');
console.log('   - Discord Developer Portal: https://discord.com/developers/applications');
console.log('   - Render Dashboard: https://dashboard.render.com/');
console.log('   - MongoDB Atlas: https://cloud.mongodb.com/');
