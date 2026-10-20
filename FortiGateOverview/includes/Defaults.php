<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        includes/Defaults.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Fuente única de los ajustes del widget y de sus valores predeterminados.
**                 La usan el formulario de configuración y el controlador de datos.
*/

namespace Modules\FortiGateOverview\Includes;

final class Defaults {

	public const SETTINGS = [
		// Idioma de la interfaz: 0 = Español, 1 = Português (Brasil), 2 = English.
		'language' => I18n::LANG_ES,

		// Alcance de los datos.
		'max_hosts' => 200,
		'wan_regex' => '(wan|internet|isp|outside|uplink|broadband|sdwan)',
		'expected_down_regex' => '^(ssl\.|quarantine\.|onboarding\.|fortilink)',
		'history_hours' => 24,
		'enable_auto_rotation' => 0,
		'page_display_period' => 30,

		// Secciones visibles.
		'show_fleet' => 1,
		'show_overview' => 1,
		'show_interface_map' => 1,
		'show_problems' => 1,
		'show_interfaces' => 1,
		'show_sdwan' => 1,
		'show_vpn' => 1,
		'show_security' => 1,
		'show_ha' => 1,
		'show_policies' => 1,
		'show_licenses' => 1,
		'show_wireless' => 1,
		'show_sensors' => 1,
		'show_vdom' => 1,
		'show_system' => 1,

		// Umbrales de recursos.
		'cpu_warn' => 80,
		'cpu_crit' => 90,
		'memory_warn' => 80,
		'memory_crit' => 90,
		'disk_free_warn' => 20,
		'disk_free_crit' => 10,
		'bandwidth_warn' => 75,
		'bandwidth_crit' => 90,
		'temperature_warn' => 60,
		'temperature_crit' => 75,

		// Umbrales de disponibilidad y calidad de enlace.
		'icmp_loss_warn' => 5,
		'icmp_loss_crit' => 20,
		'icmp_rtt_warn' => 150,
		'icmp_rtt_crit' => 300,
		'latency_warn' => 100,
		'latency_crit' => 200,
		'jitter_warn' => 20,
		'jitter_crit' => 50,
		'loss_warn' => 5,
		'loss_crit' => 20,

		// Umbrales de ciclo de vida.
		'license_warn_days' => 30,
		'license_crit_days' => 7,
		'policy_unused_days' => 90,
		'stale_minutes' => 15
	];

	/**
	 * Combina los valores guardados del widget con los predeterminados y normaliza sus tipos.
	 */
	public static function merge(array $values): array {
		$result = self::SETTINGS;

		foreach (self::SETTINGS as $key => $default) {
			if (!array_key_exists($key, $values) || $values[$key] === null || $values[$key] === '') {
				continue;
			}
			$result[$key] = is_int($default) ? (int) $values[$key] : (string) $values[$key];
		}

		$result['language'] = I18n::normalize($values['language'] ?? null);

		return $result;
	}
}
