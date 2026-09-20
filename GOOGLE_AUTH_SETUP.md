# Google Auth Platform — backend local

## Estado validado al 20-09-2026

**Flujo Google real aprobado en emulador Android API 35.** Se sustituyó el ID Android inicialmente suministrado por el nuevo ID de tipo Web application en `.env:GOOGLE_CLIENT_ID` y `Android/auth.properties:GOOGLE_WEB_CLIENT_ID`. Ambos coinciden; Google está habilitado. El cliente Android OAuth fue recreado por el propietario y los accesos reales funcionan con la configuración actual.

El primer login validó un token Google real y creó un usuario con identidad Google y sesión propia en `deep-drill.users`; se comprobó matchingUsers=1. Android mostró Main Menu y conservó la sesión al forzar cierre/reabrir. Sign Out dejó la sesión Mongo revocada y eliminó la local; reabrir mostró Login. El segundo login reutilizó el mismo UUID de usuario y creó otra sesión con UUID distinto, sin duplicados.

Causa del error anterior 28444: el primer ID configurado como audiencia era de tipo Android, según la captura de Console. La corrección fue usar el ID Web. No se automatizó contraseña/MFA; el propietario agregó su cuenta manualmente y las pruebas utilizaron el selector oficial.

## Campos exactos en Google Cloud Console

En [Google Auth Platform](https://console.cloud.google.com/auth/overview), usa el mismo proyecto para ambos clientes:

1. **Branding**: nombre `Deep Drill`, tus datos de soporte/contacto. Completa Get started si aparece.
2. **Audience**: External para una cuenta personal. En Testing, **Test users → Add users**: cuenta autorizada para este test manual `ashia.gonzalez@gmail.com`. El email no se usa como credencial ni como primary key.
3. **Clients → Create client → Android**. Name: `Deep Drill Android Debug`. Package name: `com.deepdrill.game.debug`. SHA-1: `B4:25:3B:EA:A1:D2:4A:91:68:47:3B:05:F6:CB:84:65:AA:78:90:C9`. Esta huella procede de `./gradlew signingReport` del cliente el 20-09-2026, sin modificar el keystore. Release es `com.deepdrill.game` y requerirá su propia firma.
4. **Clients → Create client → Web application**. Name: `Deep Drill Backend`. Copia el Client ID terminado en `.apps.googleusercontent.com`. Este intercambio nativo no utiliza un redirect web ni necesita un Client Secret en el juego. Reutiliza un cliente existente si corresponde.
5. En `.env` local configura `GOOGLE_CLIENT_ID=<WEB_OAUTH_CLIENT_ID_REAL>` y `AUTH_GOOGLE_ENABLED=true`. En `Android/auth.properties`, `GOOGLE_WEB_CLIENT_ID=<EL_MISMO_VALOR>`. No uses el ID del cliente Android como audience. No inventes el valor ni pegues literalmente los marcadores.

Conserva MONGODB_URI con la base `deep-drill`, JWT_SECRET y resto de configuración existente. `.env` sigue ignorado por Git/Docker. Reinicia `npm run start:dev`; reconstruye/reinstala Android. No se solicita ni persiste contraseña Google. Si Google solicita contraseña o MFA, el usuario interactúa personalmente con la UI oficial.

## Flujo y comprobación

Credential Manager entrega un ID token a Android; `POST /api/v1/auth/sign-in` recibe provider=google y credential=ID token. GoogleIdentityProvider usa `OAuth2Client.verifyIdToken` con audiencia GOOGLE_CLIENT_ID y verifica firma, issuer y expiración. El usuario se identifica por `(google, sub)`; el email no identifica ni fusiona cuentas. NestJS crea una sesión propia y devuelve JWT Deep Drill; ni ID token ni JWT se guardan en Mongo.

El emulador usa `http://10.0.2.2:3000/api/v1`. El backend escucha `0.0.0.0:3000`. IP LAN detectada del Mac: `192.168.1.3` (puede cambiar); para teléfono físico configura la URL LAN en el cliente. Release exige HTTPS.

Comprueba `GET /api/v1/health` → `{"status":"ok","database":"up"}` y log `Mongo connected`. Completa el selector Google en Android, comprueba Main Menu y toma el User ID del log seguro. Ejecuta `node scripts/verify-google-user.cjs <USER_ID>`: provider=google, identityPresent=true, matchingUsers=1. El script sólo lee y no imprime email/sub/credenciales.

Después de forzar cierre/reabrir debe aparecer Main Menu. Settings → Sign Out debe revocar la sesión, borrar almacenamiento local, limpiar credential state y volver a Login. Tras cierre/reabrir debe seguir en Login. Otro login Google debe mantener el mismo UUID de usuario y crear otra sesión; el script permite confirmar cada estado.

Ante developer error revisa paquete, SHA-1, Android client y Web Client ID. Ante acceso denegado en Testing revisa Audience → Test users. Ante rechazo de audiencia compara Web Client ID de ambos proyectos. Los errores de la librería se sanitizan, no se retornan tokens ni detalles internos.

**La prueba Google real descrita arriba ya se completó; estos pasos permiten repetirla.**

Fuentes oficiales consultadas antes de modificar código: [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation), [verificación backend](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Branding/Audience](https://developers.google.com/workspace/guides/configure-oauth-consent), [Clients](https://developers.google.com/workspace/guides/create-credentials).

## Resultado de verificación local (20-09-2026)

Lint y compilación aprobados; 27 unit tests y 8 E2E con Mongo aislado aprobados. `npm run start:dev` arrancó contra Atlas y registró `Mongo connected`. Health desde el Mac y desde el emulador Android API 35 devolvió HTTP 200 y database=up. En cliente: 208 unit tests, builds debug/release, 3 pruebas Keystore y 1 de conectividad aprobados.

La prueba real con el ID Web correcto fue aprobada: selector Google, validación backend, usuario único Atlas, sesión propia, Main Menu, persistencia al reabrir, logout y segundo login sin duplicados. El informe completo está en `../Android/docs/authentication/GOOGLE_AUTH_VALIDATION.md` cuando ambos repositorios están juntos.

Auditoría de archivos candidatos a Git: sin contraseña Google, sin coincidencias de los secretos reales Mongo/JWT; email autorizado sólo en guía de test manual. `.env` sigue ignorado y con permisos 0600. No se persisten ID tokens Google; las sesiones JWT Deep Drill son independientes.
