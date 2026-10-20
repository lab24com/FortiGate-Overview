<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        includes/I18n.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Idiomas del widget y traducción de las etiquetas del formulario de configuración
**                 (Español, Português Brasil e English).
*/

namespace Modules\FortiGateOverview\Includes;

final class I18n {

	public const LANG_ES = 0;
	public const LANG_PT_BR = 1;
	public const LANG_EN = 2;

	/** Opciones del selector de idioma; cada idioma se muestra con su nombre nativo. */
	public const LANGUAGES = [
		self::LANG_ES => 'Español',
		self::LANG_PT_BR => 'Português (Brasil)',
		self::LANG_EN => 'English'
	];

	/** Etiquetas del formulario: clave => [español, português, english]. */
	private const LABELS = [
		'language' => ['Idioma del widget', 'Idioma do widget', 'Widget language'],
		'groupids' => ['Grupos de hosts', 'Grupos de hosts', 'Host groups'],
		'hostids' => ['Hosts FortiGate', 'Hosts FortiGate', 'FortiGate hosts'],
		'max_hosts' => ['Máximo de firewalls', 'Máximo de firewalls', 'Maximum firewalls'],
		'wan_regex' => ['Expresión regular de interfaces WAN', 'Expressão regular de interfaces WAN', 'WAN interface regular expression'],
		'expected_down_regex' => ['Expresión regular de interfaces DOWN esperadas', 'Expressão regular de interfaces DOWN esperadas', 'Expected DOWN interface regular expression'],
		'history_hours' => ['Periodo de histórico (horas, máx. 168)', 'Período do histórico (horas, máx. 168)', 'History period (hours, max 168)'],
		'enable_auto_rotation' => ['Activar rotación automática de firewalls', 'Ativar rotação automática de firewalls', 'Enable automatic firewall rotation'],
		'page_display_period' => ['Tiempo por firewall (segundos)', 'Tempo por firewall (segundos)', 'Firewall display period (seconds)'],

		'show_fleet' => ['Mostrar lista de FortiGates (2 o más firewalls)', 'Mostrar lista de FortiGates (2 ou mais firewalls)', 'Show FortiGate list (2 or more firewalls)'],
		'show_overview' => ['Mostrar resumen', 'Mostrar resumo', 'Show overview'],
		'show_interface_map' => ['Mostrar mapa de interfaces en el resumen', 'Mostrar mapa de interfaces no resumo', 'Show interface map in overview'],
		'show_problems' => ['Mostrar problemas', 'Mostrar problemas', 'Show problems'],
		'show_interfaces' => ['Mostrar interfaces de red', 'Mostrar interfaces de rede', 'Show network interfaces'],
		'show_sdwan' => ['Mostrar SD-WAN', 'Mostrar SD-WAN', 'Show SD-WAN'],
		'show_vpn' => ['Mostrar VPN', 'Mostrar VPN', 'Show VPN'],
		'show_security' => ['Mostrar contadores de seguridad IPS', 'Mostrar contadores de segurança IPS', 'Show IPS security counters'],
		'show_ha' => ['Mostrar clúster HA', 'Mostrar cluster HA', 'Show HA cluster'],
		'show_policies' => ['Mostrar políticas de firewall (HTTP)', 'Mostrar políticas de firewall (HTTP)', 'Show firewall policies (HTTP)'],
		'show_licenses' => ['Mostrar licencias FortiGuard (HTTP)', 'Mostrar licenças FortiGuard (HTTP)', 'Show FortiGuard licenses (HTTP)'],
		'show_wireless' => ['Mostrar FortiAP inalámbrico (SNMP)', 'Mostrar FortiAP sem fio (SNMP)', 'Show FortiAP wireless (SNMP)'],
		'show_sensors' => ['Mostrar sensores de hardware', 'Mostrar sensores de hardware', 'Show hardware sensors'],
		'show_vdom' => ['Mostrar VDOM', 'Mostrar VDOM', 'Show VDOM'],
		'show_system' => ['Mostrar sistema y calidad de datos', 'Mostrar sistema e qualidade dos dados', 'Show system and data quality'],

		'cpu_warn' => ['CPU advertencia (%)', 'CPU alerta (%)', 'CPU warning (%)'],
		'cpu_crit' => ['CPU crítico (%)', 'CPU crítico (%)', 'CPU critical (%)'],
		'memory_warn' => ['Memoria advertencia (%)', 'Memória alerta (%)', 'Memory warning (%)'],
		'memory_crit' => ['Memoria crítico (%)', 'Memória crítico (%)', 'Memory critical (%)'],
		'disk_free_warn' => ['Disco libre advertencia (%)', 'Disco livre alerta (%)', 'Disk free warning (%)'],
		'disk_free_crit' => ['Disco libre crítico (%)', 'Disco livre crítico (%)', 'Disk free critical (%)'],
		'bandwidth_warn' => ['Utilización de interfaz advertencia (%)', 'Utilização de interface alerta (%)', 'Interface utilization warning (%)'],
		'bandwidth_crit' => ['Utilización de interfaz crítico (%)', 'Utilização de interface crítico (%)', 'Interface utilization critical (%)'],
		'temperature_warn' => ['Temperatura advertencia (°C)', 'Temperatura alerta (°C)', 'Temperature warning (°C)'],
		'temperature_crit' => ['Temperatura crítico (°C)', 'Temperatura crítico (°C)', 'Temperature critical (°C)'],
		'icmp_loss_warn' => ['Pérdida ICMP advertencia (%)', 'Perda ICMP alerta (%)', 'ICMP loss warning (%)'],
		'icmp_loss_crit' => ['Pérdida ICMP crítico (%)', 'Perda ICMP crítico (%)', 'ICMP loss critical (%)'],
		'icmp_rtt_warn' => ['Tiempo de respuesta ICMP advertencia (ms)', 'Tempo de resposta ICMP alerta (ms)', 'ICMP response time warning (ms)'],
		'icmp_rtt_crit' => ['Tiempo de respuesta ICMP crítico (ms)', 'Tempo de resposta ICMP crítico (ms)', 'ICMP response time critical (ms)'],
		'latency_warn' => ['Latencia SD-WAN advertencia (ms)', 'Latência SD-WAN alerta (ms)', 'SD-WAN latency warning (ms)'],
		'latency_crit' => ['Latencia SD-WAN crítico (ms)', 'Latência SD-WAN crítico (ms)', 'SD-WAN latency critical (ms)'],
		'jitter_warn' => ['Jitter SD-WAN advertencia (ms)', 'Jitter SD-WAN alerta (ms)', 'SD-WAN jitter warning (ms)'],
		'jitter_crit' => ['Jitter SD-WAN crítico (ms)', 'Jitter SD-WAN crítico (ms)', 'SD-WAN jitter critical (ms)'],
		'loss_warn' => ['Pérdida SD-WAN advertencia (%)', 'Perda SD-WAN alerta (%)', 'SD-WAN packet loss warning (%)'],
		'loss_crit' => ['Pérdida SD-WAN crítico (%)', 'Perda SD-WAN crítico (%)', 'SD-WAN packet loss critical (%)'],
		'license_warn_days' => ['Vencimiento de licencia advertencia (días)', 'Vencimento de licença alerta (dias)', 'License expiry warning (days)'],
		'license_crit_days' => ['Vencimiento de licencia crítico (días)', 'Vencimento de licença crítico (dias)', 'License expiry critical (days)'],
		'policy_unused_days' => ['Política sin uso después de (días)', 'Política sem uso após (dias)', 'Policy considered unused after (days)'],
		'stale_minutes' => ['Datos desactualizados después de (minutos)', 'Dados desatualizados após (minutos)', 'Data considered stale after (minutes)'],

		// Títulos de los grupos plegables del formulario.
		'fieldset_sections' => ['Secciones visibles', 'Seções visíveis', 'Visible sections'],
		'fieldset_resources' => ['Umbrales de recursos', 'Limites de recursos', 'Resource thresholds'],
		'fieldset_availability' => ['Umbrales de disponibilidad y SD-WAN', 'Limites de disponibilidade e SD-WAN', 'Availability and SD-WAN thresholds'],
		'fieldset_lifecycle' => ['Umbrales de ciclo de vida', 'Limites de ciclo de vida', 'Lifecycle thresholds']
	];

	/**
	 * Etiqueta traducida de un campo o grupo del formulario.
	 */
	public static function label(string $key, int $language): string {
		$labels = self::LABELS[$key] ?? null;

		if ($labels === null) {
			return $key;
		}

		return $labels[$language] ?? $labels[self::LANG_ES];
	}

	/**
	 * Normaliza el valor guardado del selector de idioma.
	 */
	public static function normalize($value): int {
		$value = is_numeric($value) ? (int) $value : -1;

		return array_key_exists($value, self::LANGUAGES) ? $value : self::userLanguage();
	}

	/**
	 * Idioma predeterminado según el idioma del usuario de Zabbix (es_*, pt_*, en_*); español si no coincide.
	 */
	public static function userLanguage(): int {
		$lang = '';

		try {
			if (class_exists('CWebUser') && isset(\CWebUser::$data['lang'])) {
				$lang = (string) \CWebUser::$data['lang'];
			}

			// "default" significa el idioma predeterminado del frontend.
			if (($lang === '' || $lang === 'default') && class_exists('CSettingsHelper')) {
				$lang = (string) \CSettingsHelper::get(\CSettingsHelper::DEFAULT_LANG);
			}
		}
		catch (\Throwable $exception) {
			$lang = '';
		}

		if (str_starts_with($lang, 'pt')) {
			return self::LANG_PT_BR;
		}

		if (str_starts_with($lang, 'en')) {
			return self::LANG_EN;
		}

		return self::LANG_ES;
	}
}
