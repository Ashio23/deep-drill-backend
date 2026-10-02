# Producción y recuperación — 02-10-2026

## Servicios y dominio

- API: **https://api.deepdrill.cl/api/v1**; Swagger: **https://api.deepdrill.cl/api/docs/**; salud: `GET /api/v1/health`.
- VPS HostGator: `129.121.46.191`, Ubuntu 22.04.5, SSH `22022`, usuario de aplicación/Hestia `deepdrill`.
- NIC: delegación guardada y verificada en `.cl`: `ns1.miraeste.cl`, `ns2.miraeste.cl`. La zona Hestia apunta el dominio y `www` a la VPS; TTL 300. Ambos NS residen en la misma VPS.
- Hestia administra Let's Encrypt para `api.deepdrill.cl`, `deepdrill.cl` y `www.deepdrill.cl`, redirección HTTPS y HSTS. Plantillas propias en `/usr/local/hestia/data/templates/web/nginx/php-fpm/deepdrill-api.{tpl,stpl}`. Su excepción `.well-known` permite los challenges generados por Hestia y la renovación.
- Node `24.21.0`, API `127.0.0.1:3200`, servicio `deepdrill-api`.
- MongoDB `8.0.32`, `127.0.0.1:27017`, servicio `mongod`, base `deep-drill`. Aplicación `deepdrill_app` sólo tiene `readWrite` sobre esa base.
- OpenBao `2.7.1`, TLS `127.0.0.1:8200`, servicio `openbao`, Raft `/opt/openbao/data`.
- Miraeste conserva sus servicios `miraeste-api`/`miraeste-web`, PostgreSQL y configuración propia. Su health HTTPS siguió respondiendo durante las comprobaciones.

MongoDB, OpenBao y Node no escuchan públicamente. No se requiere abrir sus puertos. El certificado interno de OpenBao está en `/etc/deepdrill/openbao-ca.crt`; no se desactiva la validación TLS. Los límites de memoria son 512 MiB para API/agente, 1 GiB para Mongo y 384 MiB para OpenBao. Tras la migración había unos 2.5 GiB disponibles y no se usaba swap. Toda la instalación comparte un único punto de fallo con Miraeste.

## Acceso a Hestia y alcance de sus cuentas

Entrar con **`admin`** y usar **Usuarios → iniciar sesión como el usuario** para administrar ambos proyectos. `miraeste` y `deepdrill` conservan roles normales; cada uno ve únicamente sus propios recursos. No se debe elevar la cuenta que ejecuta Node a administradora para obtener una vista general. `root` es la cuenta del sistema/VNC, distinta de `admin` en Hestia.

- Usuario `miraeste`: `miraeste.cl`, su correo y su PostgreSQL registrados en Hestia.
- Usuario `deepdrill`: zona DNS `deepdrill.cl`, sitios `deepdrill.cl` y `api.deepdrill.cl`. La contraseña de esta cuenta está en el archivo privado `hestia-account.json` del paquete de recuperación.

MongoDB `deep-drill` existe en la VPS, pero **no aparece en la pestaña DB de Hestia**: la versión instalada sólo implementa los tipos `mysql` y `pgsql`. Mongo se administra con sus herramientas y roles propios. Tampoco los jugadores de Deep Drill ni los usuarios de la aplicación Miraeste son cuentas del panel: Hestia administra alojamiento, dominios y correo. [Roles de Hestia](https://hestiacp.com/docs/user-guide/users), [bases de datos admitidas](https://hestiacp.com/docs/user-guide/databases).

`api.deepdrill.cl` es el host canónico del backend. `deepdrill.cl` conserva temporalmente las rutas anteriores para los clientes ya compilados; se puede asignar el dominio raíz a un sitio web al retirar esa compatibilidad. El registro `api` se administra en la zona DNS de Hestia; no exige cambiar otra vez la delegación en NIC.

Swagger está habilitado mediante `SWAGGER_ENABLED=true` en OpenBao. La raíz del host API abre `/api/docs/`; el esquema está en `/api/docs-json`. Las rutas versionadas mantienen `/api/v1`. **Try it out** usa producción y sus operaciones de registro/login/logout tienen efectos reales.

## Despliegues

Repositorio: https://github.com/Ashio23/deep-drill-backend. `push main` ejecuta `.github/workflows/deploy.yml`: instalación reproducible, lint, formato, 50 tests unitarios, 11 de integración con Mongo real, 6 del receptor de despliegue, compilación y paquete Linux. Las cifras corresponden a esta entrega. Los PR sólo verifican.

La variable de repositorio `DEPLOY_ENABLED=true` habilita despliegues y el entorno `production` admite `main`. GitHub sólo guarda `DEPLOY_SSH_KEY` y `DEPLOY_KNOWN_HOSTS`; no recibe secretos de la aplicación. La identidad SSH verifica la clave del servidor y sólo puede llamar al receptor `/usr/local/bin/deepdrill-ci` con un SHA y checksum. No puede ejecutar una shell ni modificar servicios ajenos.

Las releases están en `/home/deepdrill/apps/releases/<SHA>`, con enlace `current`. Se conservan cinco. Se verifica salud local tras el cambio; si falla, se restaura el enlace anterior y se reinicia la API. Esto no revierte datos ni versiones de secretos. La indisponibilidad durante un reinicio es de algunos segundos; no es un despliegue sin interrupciones.

Primera entrega validada: [GitHub Actions 37039875121](https://github.com/Ashio23/deep-drill-backend/actions/runs/37039875121), commit `3c7605f`. Los siguientes pushes usan el mismo circuito. Para detener nuevas entregas se puede cambiar `DEPLOY_ENABLED=false`; no detiene el servicio ya instalado. Los cambios de infraestructura de este directorio requieren instalación administrativa explícita; subir una plantilla no la aplica automáticamente al servidor.

## Secretos y reinicios

OpenBao KV v2:

- `secret/deepdrill/production`: configuración de Node, URI local, JWT y proveedores.
- `secret/deepdrill/backup`: URI de Mongo con rol `backup`.
- `secret/deepdrill/database-admin`: credencial administrativa de Mongo.

El AppRole `deepdrill-runtime` sólo lee `production`; `deepdrill-backup` sólo lee su secreto y el snapshot Raft. Las credenciales iniciales son archivos root `0600` en `/etc/deepdrill`, entregados por `LoadCredential` a los procesos. OpenBao Agent inyecta el entorno directamente a Node y reinicia el hijo al cambiar un secreto; no genera un `.env` de producción. Las revisiones KV se limitan a diez. La auditoría usa HMAC para valores sensibles y rota diariamente, hasta 14 archivos.

**Tras reiniciar la VPS o OpenBao hay que desprecintar OpenBao manualmente con dos de las tres claves externas.** Los despliegues normales sólo reinician API/agente. No se guarda una clave de desprecintado en la VPS ni se pretende auto-unseal sin un KMS independiente.

Desde una consola administrativa de la VPS:

```sh
export BAO_ADDR=https://127.0.0.1:8200
export BAO_CACERT=/etc/deepdrill/openbao-ca.crt
bao status
bao operator unseal
bao operator unseal
# Cada ejecución pide una clave distinta sin incluirla en el historial.
bao login -method=userpass username=deepdrill-operator
# Introducir la contraseña cuando se solicite.
bao kv patch secret/deepdrill/production MAINTENANCE_MODE=true
# Al terminar el mantenimiento:
bao kv patch secret/deepdrill/production MAINTENANCE_MODE=false
systemctl status deepdrill-api mongod openbao
curl --fail https://api.deepdrill.cl/api/v1/health
bao token revoke -self
rm -f ~/.vault-token
```

El operador tiene permisos sobre los secretos de Deep Drill, sus AppRoles y snapshots, sin administrar otras rutas. El token root inicial se revoca al terminar la puesta en marcha. Las claves Shamir permiten recuperar acceso administrativo mediante `bao operator generate-root` si fuera necesario. No regenerar JWT ni claves de proveedores como parte de un despliegue.

El paquete privado de recuperación se entrega fuera del repositorio, en `~/.ssh/deepdrill-recovery-20261002` del Mac de administración, directorio `0700`, archivos `0600`. Contiene las claves Shamir, acceso del operador, credenciales de recuperación de Mongo/Hestia, configuración anterior, verificación de migración y una copia de respaldo. Guardar otra copia cifrada en un lugar independiente antes de retirar este equipo. Las tres claves juntas permiten recuperar el control completo; no son archivos para compartir ni subir a GitHub.

## Migración y compatibilidad

Origen Atlas MongoDB `8.0.34`, base `deep-drill`. Primero se restauró una copia de ensayo. Después se activó mantenimiento en el backend anterior, se verificó HTTP 503 en las rutas de autenticación y se hizo el dump final. Se restauraron **6 documentos de usuarios**; coincidieron los hashes de todos los documentos completos y los índices `_id_` y `unique_provider_identity`. Se conservaron IDs, hashes de contraseña, identidades de Google/Facebook, sesiones y JWT de producción.

Después se activó la VPS y se probaron registro, login por contraseña, rechazo de contraseña inválida, logout y rechazo de sesión revocada. La cuenta temporal se eliminó. La comprobación de infraestructura no sustituye una nueva prueba interactiva de login de Google/Facebook.

Render ejecuta temporalmente `node scripts/legacy-proxy.cjs`, con auto-deploy **Off** y únicamente `PORT` como variable propia. La URL antigua sigue remitiendo las rutas conocidas a `deepdrill.cl`; se comprobó login por Render y revocación del mismo token por la URL nueva. No tiene acceso a Mongo ni emite tokens. Sus límites/arranque en frío siguen afectando únicamente a clientes antiguos. Se puede retirar cuando los clientes instalados hayan actualizado su URL.

Android usa `https://api.deepdrill.cl/api/v1` por defecto; también se actualizó el override local. Build debug y tests de core pasaron. Los resultados históricos de pruebas de Render/Atlas se conservan como tales.

Atlas se conserva como copia de retorno, sin backend activo escribiendo allí. No se borró el clúster ni su cuenta. Una vuelta a Atlas después de aceptar escrituras nuevas en la VPS requiere parar escrituras y copiar el estado actualizado: cambiar únicamente la URI perdería datos posteriores a la migración.

## Respaldos y restauración

`deepdrill-backup.timer` ejecuta diariamente a las 04:30 hora del servidor, con hasta 15 minutos aleatorios. Captura dump autenticado de `deep-drill`, snapshot Raft y checksums en `/var/backups/deepdrill/<UTC>/`, conserva los siete últimos conjuntos completos y revoca su token de trabajo. Los archivos son privados y la contraseña temporal sólo existe en `/run` durante el dump.

```sh
systemctl list-timers deepdrill-backup.timer
systemctl start deepdrill-backup.service
journalctl -u deepdrill-backup --since today
```

Se copió un conjunto fuera de la VPS. **La copia externa periódica aún no está automatizada**: los respaldos diarios locales no protegen frente a pérdida total del servidor. Descargarlos periódicamente a almacenamiento independiente; los dumps contienen datos personales y requieren almacenamiento privado/cifrado.

Pruebas realizadas:

1. El dump diario se restauró en una base temporal y se compararon documentos completos e índices con la migración final.
2. El snapshot de OpenBao se restauró en una instancia temporal con puertos y almacenamiento separados; las claves Shamir externas la desprecintaron y todos los secretos de producción coincidieron.
3. Se retiraron ambas instancias/bases de prueba y se verificó que Miraeste continuaba saludable.

Para recuperar en una VPS nueva, reinstalar las versiones compatibles, servicios y plantillas, restaurar OpenBao siguiendo [snapshot restore](https://openbao.org/docs/commands/operator/raft/), desprecintar con las claves del respaldo y recuperar Mongo con `mongorestore --config=<archivo-root-0600> --archive=<dump> --gzip`. Los dumps de aplicación no incluyen los usuarios administrativos de Mongo: recrearlos con las credenciales de recuperación y roles documentados antes de iniciar la API. Instalar sus AppRole credentials mediante `LoadCredential`, publicar una release verificada y comprobar health/autenticación antes de cambiar DNS. Mantener las copias y la configuración anterior hasta validar completamente el resultado.

No ejecutar `--drop` contra producción sin mantenimiento, un respaldo reciente y una decisión explícita de restauración. Los ejemplos de ensayo utilizaron bases distintas, nunca la base de Miraeste.
