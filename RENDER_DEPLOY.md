# Guía de Despliegue en Render

## ✅ Verificación Previa

Antes de desplegar en Render, ejecuta localmente:

```bash
npm run debug-render
```

Este comando verificará que todas las dependencias estén instaladas correctamente.

## 🚀 Pasos para Desplegar en Render

### 1. Configuración del Servicio

- **Build Command**: `npm ci`
- **Start Command**: `npm start`
- **Node Version**: 18.19.0 (especificado en `.nvmrc`)

### 2. Variables de Entorno Requeridas

Configura estas variables en el Dashboard de Render:

```
BOT_TOKEN=tu_bot_token_aqui
DISCORD_CLIENT_ID=tu_client_id_aqui
DISCORD_CLIENT_SECRET=tu_client_secret_aqui
MONGODB_URI=tu_mongodb_uri_aqui
SESSION_SECRET=tu_session_secret_aqui
PRODUCTION_URL=https://tu-app.onrender.com
NODE_ENV=production
PORT=10000
```

### 3. Configuración Automática

El archivo `render.yaml` ya está configurado con:
- Comando de build: `npm ci`
- Comando de inicio: `npm start`
- Variables de entorno base
- Health check en la ruta `/`

## 🔧 Solución de Problemas

### Error: "Cannot find module 'connect-mongo'"

1. **Verificar Node.js version**: Asegúrate de que Render use Node.js 18+
2. **Limpiar cache**: En Render Dashboard, realiza un "Clear Cache" y redeploy
3. **Verificar package-lock.json**: Debe estar presente en el repositorio

### Error: "Module not found"

1. Ejecuta localmente:
   ```bash
   npm ci
   npm run debug-render
   ```

2. Si local funciona pero Render no:
   - Verifica que `package-lock.json` esté en el repo
   - Asegúrate de que el build command sea `npm ci` (no `npm install`)

### Error: "Build failed"

1. Revisa los logs de build en Render Dashboard
2. Verifica que todas las variables de entorno estén configuradas
3. Confirma que el repositorio tenga:
   - `package.json`
   - `package-lock.json` 
   - `.nvmrc`
   - `render.yaml`

## 📝 Checklist de Despliegue

- [ ] Variables de entorno configuradas en Render
- [ ] Archivo `.nvmrc` presente (Node.js 18.19.0)
- [ ] Archivo `render.yaml` configurado
- [ ] `package-lock.json` actualizado
- [ ] Build command: `npm ci`
- [ ] Start command: `npm start`
- [ ] Health check habilitado en `/`

## 🔍 Comandos Útiles para Debug

```bash
# Verificar dependencias localmente
npm run debug-render

# Limpiar e instalar dependencias
npm ci

# Ejecutar en modo producción localmente
NODE_ENV=production npm start
```

## 📞 Soporte

Si sigues teniendo problemas:

1. Verifica los logs detallados en Render Dashboard
2. Ejecuta `npm run debug-render` localmente
3. Compara las versiones de Node.js entre local y Render
4. Asegúrate de que todas las variables de entorno estén configuradas correctamente
