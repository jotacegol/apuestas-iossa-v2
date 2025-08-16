#!/usr/bin/env node

const axios = require('axios');

async function testAuthFlow() {
    console.log('🔍 Diagnóstico del flujo de autenticación Discord');
    console.log('='.repeat(50));

    const baseUrl = 'http://localhost:3000';
    
    console.log('\n1️⃣ Probando endpoint de estado de auth sin sesión...');
    try {
        const response = await axios.get(`${baseUrl}/api/auth/status`, {
            validateStatus: () => true
        });
        console.log(`   Status: ${response.status}`);
        console.log(`   Data:`, response.data);
        
        if (response.data.error) {
            console.log('   ❌ Error encontrado:', response.data.error);
        }
        
    } catch (error) {
        console.log('   ❌ Error en la petición:', error.message);
    }

    console.log('\n2️⃣ Probando endpoint de Discord auth...');
    try {
        const response = await axios.get(`${baseUrl}/auth/discord`, {
            maxRedirects: 0,
            validateStatus: () => true
        });
        console.log(`   Status: ${response.status}`);
        
        if (response.status === 302) {
            console.log('   ✅ Redirección a Discord detectada');
            console.log(`   Location: ${response.headers.location}`);
            
            // Verificar que la URL de Discord es correcta
            if (response.headers.location && response.headers.location.includes('discord.com')) {
                console.log('   ✅ URL de Discord válida');
            } else {
                console.log('   ❌ URL de Discord inválida');
            }
        } else {
            console.log('   ❌ No hay redirección a Discord');
        }
    } catch (error) {
        console.log('   ❌ Error:', error.message);
    }

    console.log('\n3️⃣ Verificando variables de entorno...');
    const requiredVars = ['BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'MONGODB_URI', 'SESSION_SECRET'];
    for (const varName of requiredVars) {
        if (process.env[varName]) {
            console.log(`   ✅ ${varName}: Configurada (${process.env[varName].substring(0, 10)}...)`);
        } else {
            console.log(`   ❌ ${varName}: FALTA`);
        }
    }

    console.log('\n4️⃣ Probando conexión con Discord API...');
    try {
        const response = await axios.get(`https://discord.com/api/oauth2/applications/@me`, {
            headers: {
                'Authorization': `Bot ${process.env.BOT_TOKEN}`
            },
            validateStatus: () => true
        });
        
        console.log(`   Status: ${response.status}`);
        if (response.status === 200) {
            console.log('   ✅ Conexión con Discord API exitosa');
            console.log(`   App Name: ${response.data.name}`);
        } else {
            console.log('   ❌ Error en Discord API:', response.data);
        }
    } catch (error) {
        console.log('   ❌ Error conectando con Discord:', error.message);
    }

    console.log('\n5️⃣ Probando endpoint de debug de sesión...');
    try {
        const response = await axios.get(`${baseUrl}/debug/session`, {
            validateStatus: () => true
        });
        console.log(`   Status: ${response.status}`);
        console.log(`   Data:`, response.data);
    } catch (error) {
        console.log('   ❌ Error:', error.message);
    }

    console.log('\n='.repeat(50));
    console.log('✅ Diagnóstico completado');
    
    console.log('\n💡 Recomendaciones:');
    console.log('1. Asegúrate de que el servidor esté ejecutándose en localhost:3000');
    console.log('2. Verifica que todas las variables de entorno estén configuradas');
    console.log('3. Asegúrate de que Discord Developer Portal tenga la URL correcta:');
    console.log('   http://localhost:3000/auth/discord/callback');
    console.log('4. Si el problema persiste, revisa los logs del servidor');
}

// Cargar variables de entorno
require('dotenv').config();

// Ejecutar diagnóstico
testAuthFlow().catch(console.error);
