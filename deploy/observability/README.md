# Logs de las APIs en la VPS

Instalado el 2026-10-02: Grafana OSS 13.2.3, Loki 3.7.8 y Alloy 1.20.1
(paquetes del repositorio firmado `https://apt.grafana.com`, Ubuntu 22.04).

- Visor: **https://grafana.elicloud.cl/**. El acceso anterior
  `https://logs.deepdrill.cl/` redirige al dominio nuevo.
- Inicio: dashboard **APIs · Deep Drill y Miraeste**, carpeta **Operaciones**.
- Usuario inicial: `deepdrill-admin`. Contraseña aleatoria respaldada en
  OpenBao, KV v2 `secret/deepdrill/observability`. Nunca guardar valores aquí.
- El dominio nuevo y su DNS pertenecen al usuario Hestia `admin`.
  El alias anterior `logs.deepdrill.cl` permanece bajo `deepdrill`.
  Let's Encrypt, redirección HTTPS y HSTS se administran desde Hestia.
- Inicio de sesión obligatorio; registro libre y acceso anónimo desactivados.

## Uso

Seleccionar una API o **All**; ajustar el período y **Buscar texto**. El panel
se actualiza cada 30 segundos. **Explore**, fuente **API Logs**, permite
consultas LogQL y **Live** para seguimiento por WebSocket.

```logql
{service="deepdrill-api"}
{service="miraeste-api"} |= "error"
{service=~".+"} |~ "(?i)(error|fatal|exception|warn)"
```

Se recogen stdout/stderr de `deepdrill-api.service` y `miraeste-api.service`
a través de journald, con recuperación del historial disponible de los últimos
siete días. No se recogen cuerpos HTTP ni se añade instrumentación de peticiones.
El contenido depende de lo que cada aplicación emita. Este despliegue no incluye
trazas APM, métricas de latencia por petición ni notificaciones de alertas.

El panel omite mensajes INFO periódicos del agente OpenBao que comparte la
unidad de Deep Drill; se pueden consultar en Explore sin ese filtro. La gráfica
de errores/advertencias usa coincidencias de texto, no el estado HTTP, y puede
mostrar falsos positivos. "No data" en esa gráfica puede significar que no hubo
mensajes coincidentes en el período.

Alloy elimina códigos ANSI y oculta formatos habituales de Bearer, JWT,
credenciales de URI Mongo y campos JSON sensibles. Es una protección adicional,
no un sustituto de evitar secretos/datos personales en el logger de la API.
Las etiquetas son de baja cardinalidad: servicio, entorno, fuente y nivel JSON.

## Servicios, datos y límites

| Servicio | Escucha local | Datos | MemoryHigh / MemoryMax |
|---|---|---|---|
| Grafana | 127.0.0.1:3301 | /var/lib/grafana | 256 / 512 MiB |
| Loki | 127.0.0.1:3300 HTTP, :3395 gRPC | /var/lib/loki | 384 / 768 MiB |
| Alloy | 127.0.0.1:12345 | /var/lib/alloy | 128 / 256 MiB |

Nginx publica únicamente Grafana por HTTPS. Loki no tiene autenticación propia
y debe permanecer en loopback. No abrir estos puertos al exterior.

Loki monolítico usa TSDB v13 y filesystem. Retención: **168 horas**, con
compactor cada 10 minutos y borrado diferido dos horas. Esto no constituye un
límite estricto de espacio en disco: vigilar `df -h` y `du -sh /var/lib/loki`.
Consultas con concurrencia 2 y máximo 2000 entradas; Grafana muestra hasta 1000
por consulta. Acotar el rango o el filtro para buscar más.

Las credenciales iniciales y la clave de cifrado están en archivos root:root
0600 bajo `/etc/deepdrill/observability`, entregados a Grafana mediante
`LoadCredential`. OpenBao conserva una copia de recuperación; Grafana no consulta
OpenBao en cada inicio ni sincroniza automáticamente cambios de contraseña.
Cambiar una contraseña desde Grafana requiere actualizar también la copia en
OpenBao y los archivos privados de recuperación. `admin_password` sólo inicializa
la cuenta al crear una base Grafana nueva; modificar ese archivo no rota una
cuenta existente.

## Aplicar cambios

Estos archivos contienen sólo configuración pública. El despliegue habitual del
backend mediante GitHub Actions no reinstala ni modifica este stack.

1. Copiar este directorio a una carpeta privada en la VPS.
2. Confirmar paquetes instalados y los dos archivos de credenciales presentes.
3. Ejecutar `bash apply.sh` como root. Valida Loki/Alloy y reinicia solamente
   los tres servicios del visor.
4. Las plantillas actuales pertenecen a EliCloud: `elicloud-grafana` para
   `admin/grafana.elicloud.cl` y `elicloud-grafana-legacy` para
   `deepdrill/logs.deepdrill.cl`. Tras modificar su fuente, reconstruir el dominio
   correspondiente con `v-rebuild-web-domain USUARIO DOMINIO no`, ejecutar
   `nginx -t` y recargar Nginx sólo si pasa. Las copias `deepdrill-logs.*` de este
   directorio documentan la entrada anterior; no sustituyen las plantillas EliCloud.
5. La configuración de dashboard se aprovisiona desde archivo; cambios desde la
   UI deben exportarse al JSON de este directorio para que sean persistentes.

La instalación inicial de paquetes puede intentar arrancar Loki en su puerto
predeterminado 3100, que ya usa Miraeste. En una instalación nueva, impedir el
arranque automático de estos paquetes hasta aplicar la configuración local.
El paquete Loki instala su unidad bajo `/etc/systemd/system`; un simple `mask`
previo puede ser reemplazado por su script de instalación.

La preferencia de inicio de la organización es `homeDashboardUID:
"deepdrill-api-logs"`; puede fijarse desde la UI o `PUT /api/org/preferences` con
sesión de administrador. La fuente provisionada tiene UID `api-loki`.

## Verificación y mantenimiento

```bash
systemctl is-active grafana-server loki alloy
curl -fsS http://127.0.0.1:3300/ready
curl -fsS https://grafana.elicloud.cl/api/health
curl -fsS https://api.deepdrill.cl/api/v1/health
curl -fsS https://miraeste.cl/api/health
journalctl -u alloy -u loki -u grafana-server --since '10 minutes ago'
python3 test-redaction.py
```

La prueba de redacción usa un proceso Alloy temporal, sólo datos ficticios y
salida local; no escribe en Loki ni reinicia servicios. Validar además login,
consulta de ambas APIs, filtro All y Live desde el navegador.

Para recuperar Grafana conservando usuarios/preferencias, hacer una copia
consistente de `/var/lib/grafana/grafana.db` mediante SQLite backup, junto con
provisioning/configuración y la clave de cifrado privada. La contraseña y clave
se incluyen en los snapshots de OpenBao del backup ya existente. Se creó una copia inicial consistente de Grafana/configuración privada en
`/var/backups/deepdrill-observability/observability-recovery-20261002.tar.gz`,
con copia privada fuera de la VPS y verificación de integridad SQLite.
La base de Grafana y los logs de Loki no se han añadido al backup diario
Mongo/OpenBao; esa copia inicial no se actualiza automáticamente.
El dashboard y datasource se pueden reconstruir con estos archivos; las cuentas
adicionales y personalizaciones requieren backup de Grafana.

Fuentes oficiales:
- https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/
- https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.journal/
- https://grafana.com/docs/loki/latest/operations/storage/retention/

La reorganización de dominios de infraestructura y las plantillas de los nuevos
accesos están documentadas en el [repositorio privado EliCloud](https://github.com/Ashio23/elicloud/blob/main/docs/ELICLOUD-INFRASTRUCTURE.txt).
