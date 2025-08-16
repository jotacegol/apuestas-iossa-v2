@echo off
echo ===========================================
echo  SINCRONIZANDO ARCHIVOS CON GITHUB
echo ===========================================
echo.

echo 📁 Agregando archivos al repositorio...
git add .env
git add debug-auth.js
git add discord-setup-guide.md
git add TROUBLESHOOTING.md
git add verify-setup.js
git add bot.js
git add package.json
git add public/
git add render.yaml

echo.
echo 💾 Creando commit con las actualizaciones...
git commit -m "feat: Agregar configuración OAuth mejorada y scripts de diagnóstico

- Actualizar configuración de autenticación Discord OAuth
- Agregar script de diagnóstico de autenticación (debug-auth.js)
- Agregar script de verificación del sistema (verify-setup.js)
- Incluir guías de configuración y troubleshooting
- Mejorar bot.js con logging detallado para OAuth
- Actualizar package.json con nuevos scripts
- Corregir variables de entorno para producción"

echo.
echo 🚀 Subiendo cambios a GitHub...
git push origin main

echo.
echo ✅ ¡Sincronización completa!
echo    Ve a Render y haz un deploy manual si no se despliega automáticamente
echo.
pause
