# LAKA · FortiGate Overview V2.0
**Autor:** © LAKA Soluciones Tecnológicas
 
Widget para Zabbix 7.0/7.4 orientado a equipos FortiGate. Detecta automáticamente las plantillas oficiales **FortiGate by HTTP** y **FortiGate by SNMP**.

## Qué muestra

| Sección | Contenido | Fuente |
|---|---|---|
| **Lista de FortiGates** | Tabla ordenable y filtrable de todos los firewalls: estado, modelo/FortiOS, uptime, CPU, RAM, disco, sesiones, ICMP, WAN arriba/total, SLA SD-WAN, IPsec, HA, licencias y problemas. Indicadores globales (críticos, WAN caídas, HA sin sincronizar, licencias, firmware). | HTTP + SNMP |
| **Resumen** | KPIs, verificación de salud (12 chequeos con acceso directo a cada pestaña), problemas actuales, mapa de puertos y consumo WAN. | HTTP + SNMP |
| **Problemas** | Problemas activos con severidad, opdata, duración, reconocimiento, supresión y enlace al evento. Los *Link down* de interfaces que ya están UP se separan como recuperados. | Zabbix |
| **Interfaces** | Tipo real (física, VLAN, agregada, túnel, loopback, switch), estado, velocidad, tráfico, utilización, paquetes/s, errores/s y descartes/s. | HTTP + SNMP |
| **SD-WAN** | Miembros (enlace, ancho de banda, sesiones, último cambio), matriz SLA health-check × miembro y gráficas por enlace. | HTTP (miembros) + SNMP/HTTP (SLA) |
| **VPN** | Túneles IPsec arriba/caídos por nombre, usuarios y estado del servicio SSL-VPN. | SNMP |
| **Seguridad** | Tasa IPS por severidad, bloqueos, anomalías, firmas, versión de la base IPS y eventos AV/IPS del clúster. | SNMP |
| **HA** | Modo, grupo, prioridad, override, balanceo, auto-sync, rol primario/secundario, sincronización y consistencia del checksum entre miembros. | SNMP |
| **Políticas** | Hits/s, tráfico, sesiones, % de descarga a hardware (NP), último uso; filtros para políticas sin uso, deshabilitadas, deny e IPsec. | HTTP |
| **Licencias** | Servicios FortiGuard/FortiCare: estado, vencimiento en días, versión de firmas y resultado de la última actualización. | HTTP |
| **FortiAP** | Estado de conexión, modelo/firmware, IP, clientes, CPU, RAM, banda, potencia, tráfico y uptime de cada AP gestionado. | SNMP |
| **Sensores** | Temperaturas, ventiladores y fuentes con alarma nativa y umbrales de temperatura. | SNMP |
| **VDOM** | Modo, rol HA, CPU, RAM, sesiones y tasa de sesiones por VDOM. | SNMP |
| **Sistema** | Inventario, firmware disponible, ICMP/recolectores/puerto API, CPU por núcleo (sistema/usuario), NP6lite (SoC3) y calidad de datos: errores de la API, ítems no soportados y métricas sin datos recientes. | HTTP + SNMP |

Las pestañas sólo aparecen cuando el host tiene los ítems correspondientes y la sección está habilitada.

## Instalación

1. Copiar el archivo ZIP al servidor Zabbix.
2. Descomprimirlo dentro de `/usr/share/zabbix/ui/modules/`.
3. Verificar que exista `/usr/share/zabbix/ui/modules/FortiGateOverview/`.
4. Ajustar propietario y permisos de acuerdo con el usuario del frontend web.
5. En Zabbix abrir **Administración → General → Módulos**.
6. Seleccionar **Escanear directorio** y habilitar `LAKA · FortiGate Overview`.
7. Agregar `FortiGate Overview` a un dashboard y seleccionar uno o más hosts.

## Consideraciones

- El host debe tener datos de `FortiGate by HTTP` o `FortiGate by SNMP`.
- HTTP presenta recursos, interfaces y SD-WAN. Las secciones exclusivas de la MIB SNMP, como sensores físicos, HA, VPN e IPS, se muestran cuando esos ítems existen.
- Los health-checks de SD-WAN deben estar configurados en FortiGate para que existan latencia, jitter y pérdida.
