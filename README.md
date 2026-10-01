# LAKA · FortiGate Overview

Widget para Zabbix 7.0/7.4 orientado a equipos FortiGate. Detecta automáticamente las plantillas oficiales **FortiGate by HTTP** y **FortiGate by SNMP**.

## Funciones incluidas

- Lista lateral de múltiples firewalls y estado por problemas activos.
- CPU, RAM, disco, sesiones, IPsec y usuarios SSL-VPN.
- Interfaces con estado, velocidad, entrada, salida, utilización y errores.
- Identificación automática de interfaces WAN y personalización independiente por cada firewall.
- Health-checks SD-WAN con estado, latencia, jitter y pérdida de paquetes.
- VPN, IPS, clúster HA, sensores físicos y VDOM.
- Umbrales configurables y secciones que se pueden activar u ocultar.
- Tema claro, oscuro y alto contraste heredado del frontend.
- Gráficas con ejes temporales, relleno visual, estadísticas y escalas separadas para ms, porcentaje y tráfico.
- Mapa lógico de puertos con filtros, colores de estado y acceso al histórico de cualquier interfaz.

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
