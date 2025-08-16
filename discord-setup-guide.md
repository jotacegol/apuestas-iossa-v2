# 🔧 Configuración de Discord Developer Portal

## Pasos críticos para OAuth:

### 1. Ve a Discord Developer Portal
- https://discord.com/developers/applications
- Selecciona tu aplicación (ID: 1329484347052523671)

### 2. OAuth2 Settings
Ve a la sección **OAuth2 > General**

### 3. Redirect URIs (MUY IMPORTANTE)
Asegúrate de tener EXACTAMENTE esta URL configurada:
```
https://apuestas-iossea-v2.onrender.com/auth/discord/callback
```

**IMPORTANTE:** 
- ⚠️ NO debe tener barra final (/)
- ⚠️ Debe usar HTTPS (no HTTP)  
- ⚠️ Debe coincidir exactamente con tu URL de Render

### 4. Scopes Requeridos
En la sección OAuth2, asegúrate de tener habilitado:
- `identify` ✅

### 5. Client Secret
- Tu Client Secret actual: `R3WzA-6ES55Xh9t2XSU1DqM9V4ulwPv-`
- Si regeneraste el secret, actualiza también en Render

### 6. Verificación
Después de hacer cambios en Discord:
1. Guarda los cambios
2. Espera unos minutos (Discord puede tardar en propagarse)
3. Redeploya en Render si es necesario

## URLs a verificar:
- **Desarrollo local**: `http://localhost:3000/auth/discord/callback`
- **Producción**: `https://apuestas-iossea-v2.onrender.com/auth/discord/callback`

## Problemas comunes:
1. ❌ URL mal escrita en Discord
2. ❌ HTTP en lugar de HTTPS
3. ❌ Barra final (/) extra
4. ❌ Client Secret desactualizado
5. ❌ Variables de entorno no sincronizadas entre local y Render
