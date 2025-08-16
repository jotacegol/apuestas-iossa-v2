#!/usr/bin/env node

console.log('🔍 Verificando instalación de dependencias para Render...');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Verificar dependencias críticas
const criticalDependencies = [
    'connect-mongo',
    'mongoose',
    'express',
    'discord.js',
    'axios',
    'express-session',
    'passport',
    'passport-discord'
];

console.log('\n📦 Verificando dependencias críticas:');

let allDependenciesOk = true;

for (const dep of criticalDependencies) {
    try {
        require.resolve(dep);
        console.log(`✅ ${dep}: OK`);
    } catch (error) {
        console.log(`❌ ${dep}: FALTA`);
        console.log(`   Error: ${error.message}`);
        allDependenciesOk = false;
    }
}

console.log('\n🔧 Variables de entorno requeridas:');
const requiredEnvVars = [
    'BOT_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'MONGODB_URI',
    'SESSION_SECRET'
];

let allEnvVarsOk = true;

for (const envVar of requiredEnvVars) {
    if (process.env[envVar]) {
        console.log(`✅ ${envVar}: Configurada`);
    } else {
        console.log(`❌ ${envVar}: FALTA`);
        allEnvVarsOk = false;
    }
}

console.log('\n🏗️ Verificación del sistema de archivos:');
const fs = require('fs');
const path = require('path');

const criticalFiles = ['bot.js', 'package.json'];

for (const file of criticalFiles) {
    try {
        const stats = fs.statSync(path.join(__dirname, file));
        console.log(`✅ ${file}: ${stats.size} bytes`);
    } catch (error) {
        console.log(`❌ ${file}: No encontrado`);
        allDependenciesOk = false;
    }
}

console.log('\n📊 Resumen:');
console.log(`Dependencias: ${allDependenciesOk ? '✅ OK' : '❌ FALTAN'}`);
console.log(`Variables de entorno: ${allEnvVarsOk ? '✅ OK' : '❌ FALTAN'}`);

if (allDependenciesOk && allEnvVarsOk) {
    console.log('🎉 Todo está listo para ejecutar el bot!');
    process.exit(0);
} else {
    console.log('💥 Hay problemas que resolver antes de ejecutar el bot.');
    process.exit(1);
}
