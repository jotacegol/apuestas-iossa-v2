# 🚨 Guía de Resolución Problemas OAuth Discord

## ❌ Error "No autenticado" 

### Causa más común: URL de Callback mal configurada en Discord

### ✅ Solución paso a paso:

1. **Discord Developer Portal**
   - Ve a: https://discord.com/developers/applications  
   - Selecciona tu app (Client ID: 1329484347052523671)
   - OAuth2 > General > Redirect URIs
   - **Debe estar exactamente:** `https://apuestas-iossea-v2.onrender.com/auth/discord/callback`

2. **Verificaciones**
   - ✅ Sin barra final (/)
   - ✅ Usa HTTPS (no HTTP)  
   - ✅ Coincide con tu URL de Render
   - ✅ Guarda cambios en Discord

3. **Después de cambios**
   - ⏰ Esperar 2-3 minutos
   - 🔄 Limpiar caché (Ctrl+F5)
   - 🚀 Probar de nuevo

## 🔧 Comandos útiles:

```bash
npm run debug-auth    # Diagnóstico completo
npm run verify        # Verificar configuración  
npm test             # Mismo que verify
```

## 🧪 URLs de prueba:
- **Inicio OAuth**: https://apuestas-iossea-v2.onrender.com/auth/discord
- **Estado de auth**: https://apuestas-iossea-v2.onrender.com/api/auth/status
- **Frontend**: https://apuestas-iossea-v2.onrender.com/

## 🔍 Si el problema persiste:

1. **Verificar en Render**:
   - Variables de entorno están bien configuradas
   - El servicio está ejecutándose sin errores
   - Los logs no muestran errores

2. **Discord Developer Portal**:
   - Client Secret no ha sido regenerado recientemente  
   - La aplicación está habilitada
   - Los permisos OAuth están correctos

3. **Navegador**:
   - Probar en modo incógnito
   - Probar en otro navegador
   - Limpiar todas las cookies del sitio

## 📞 Última alternativa:
Si nada funciona, regenera el Client Secret en Discord y actualiza la variable `DISCORD_CLIENT_SECRET` en Render.
