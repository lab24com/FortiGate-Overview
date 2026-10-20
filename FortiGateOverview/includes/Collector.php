<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        includes/Collector.php
** Versión:        2.0
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Lectura de los últimos valores de las plantillas "FortiGate by HTTP" y "FortiGate by SNMP".
**                 Los ítems se envían como tuplas compactas:
**                 [itemid, key_, name, lastvalue, lastclock, units, value_type, state, error].
**                 El modo ligero conserva sólo lo necesario para la flota; el detalle completo de un firewall
**                 se carga bajo demanda con la acción laka.fortigate.host.
*/

namespace Modules\FortiGateOverview\Includes;

use API;

final class Collector {

	/** Prefijos de clave solicitados a item.get (LIKE 'prefijo%' en el servidor). */
	public const KEY_PREFIXES = [
		'fgate.', 'system.', 'vm.memory.', 'vfs.fs.', 'net.ipv4.sessions', 'icmpping', 'zabbix[host,snmp,available]',
		'net.if.', 'vpn.', 'ips.', 'ha.', 'hw.sensor.', 'sdwan_health.', 'vdom.', 'wc.', 'soc3.', 'net.tcp.service['
	];

	/** Claves excluidas en modo ligero (datos que sólo usa la vista de detalle). */
	private const LIGHT_EXCLUDE = '/^(?:'
		.'fgate\.fwp\.'
		.'|fgate\.netif\.(?:in_errors|out_errors|in_packets|out_packets)\['
		.'|net\.if\.(?:in\.errors|out\.errors|in\.discards|out\.discards|adminstatus)\['
		.'|fgate\.service\.(?:type|version|update_time|update_attempt|update_method|update_result|state_changed)\['
		.'|fgate\.sdwan_member\.(?:rx_bytes|tx_bytes|rx_bandwidth|tx_bandwidth|status)\['
		.'|(?:fgate\.)?sdwan_health\.(?:sent|received)\['
		.'|ha\.(?:cpu\.usage|mem\.usage|net\.usage|session\.count|packets\.rate|ips\.events|av\.events|bytes\.rate)\['
		.'|hw\.sensor\.value\['
		.'|vdom\.'
		.'|system\.cpu\.usage\['
		.'|soc3\.'
		.'|wc\.(?!conn\.status\[|admin\.status\[|clients\.num\[)'
		.'|ips\.'
		.'|system\.(?:descr|contact|objectid)\['
		.')/';

	private const TEXT_LIMIT = 1500;

	/**
	 * Ítems relevantes de los hosts indicados, agrupados por host.
	 *
	 * @return array  hostid => ['items' => tuplas[], 'unsupported' => int]
	 */
	public static function getItems(array $hostids, bool $light): array {
		if (!$hostids) {
			return [];
		}

		// Paso 1: sólo claves (consulta liviana). Evita leer el JSON crudo de los ítems maestros (get_data / walk).
		$candidates = API::Item()->get([
			'output' => ['itemid', 'key_'],
			'hostids' => $hostids,
			'filter' => ['status' => ITEM_STATUS_ACTIVE],
			'search' => ['key_' => self::KEY_PREFIXES],
			'startSearch' => true,
			'searchByAny' => true,
			'preservekeys' => true
		]);

		$itemids = [];
		foreach ($candidates as $itemid => $candidate) {
			$key = $candidate['key_'];
			if (self::isRelevantKey($key) && (!$light || !preg_match(self::LIGHT_EXCLUDE, $key))) {
				$itemids[] = (string) $itemid;
			}
		}

		$result = [];
		foreach (array_chunk($itemids, 5000) as $chunk) {
			$rows = API::Item()->get([
				'output' => ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'value_type',
					'state', 'error'
				],
				'itemids' => $chunk
			]);

			foreach ($rows as $item) {
				$hostid = (string) $item['hostid'];
				$result[$hostid] ??= ['items' => [], 'unsupported' => 0];
				$state = (int) $item['state'];

				if ($state === ITEM_STATE_NOTSUPPORTED) {
					$result[$hostid]['unsupported']++;
					if ($light) {
						continue;
					}
				}

				$value_type = (int) $item['value_type'];
				$lastvalue = (string) $item['lastvalue'];
				if (($value_type === ITEM_VALUE_TYPE_TEXT || $value_type === ITEM_VALUE_TYPE_LOG)
						&& mb_strlen($lastvalue) > self::TEXT_LIMIT) {
					$lastvalue = mb_substr($lastvalue, 0, self::TEXT_LIMIT).'…';
				}

				$tuple = [
					(string) $item['itemid'],
					(string) $item['key_'],
					(string) $item['name'],
					$lastvalue,
					(int) $item['lastclock'],
					(string) $item['units'],
					$value_type,
					$state
				];
				if ($state === ITEM_STATE_NOTSUPPORTED && (string) $item['error'] !== '') {
					$tuple[] = mb_substr((string) $item['error'], 0, 300);
				}

				$result[$hostid]['items'][] = $tuple;
			}
		}

		return $result;
	}

	public static function isRelevantKey(string $key): bool {
		if (str_contains($key, '.get_data') || str_ends_with($key, '.walk') || str_ends_with($key, '.discovery')
				|| str_starts_with($key, 'snmptrap')) {
			return false;
		}

		foreach (self::KEY_PREFIXES as $prefix) {
			if (strncmp($key, $prefix, strlen($prefix)) === 0) {
				return true;
			}
		}

		return false;
	}

	public static function isFortiGate(array $tuples): bool {
		foreach ($tuples as $tuple) {
			$key = $tuple[1];
			if (str_starts_with($key, 'fgate.') || str_contains($key, '[fg')) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Problemas actuales con su estado de reconocimiento y supresión, agrupados por host.
	 */
	public static function getProblems(array $hostids): array {
		if (!$hostids) {
			return [];
		}

		$problems = API::Problem()->get([
			'output' => ['eventid', 'objectid', 'name', 'severity', 'clock', 'acknowledged', 'suppressed', 'opdata'],
			'hostids' => $hostids,
			'source' => EVENT_SOURCE_TRIGGERS,
			'object' => EVENT_OBJECT_TRIGGER,
			'sortfield' => ['eventid'],
			'sortorder' => ZBX_SORT_DOWN,
			'limit' => 5000
		]);

		if (!$problems) {
			return [];
		}

		$triggers = API::Trigger()->get([
			'output' => ['triggerid'],
			'triggerids' => array_values(array_unique(array_column($problems, 'objectid'))),
			'selectHosts' => ['hostid'],
			'preservekeys' => true
		]);

		$result = [];
		foreach ($problems as $problem) {
			$trigger = $triggers[$problem['objectid']] ?? null;
			if ($trigger === null) {
				continue;
			}

			foreach ($trigger['hosts'] as $host) {
				$result[(string) $host['hostid']][] = [
					'eventid' => (string) $problem['eventid'],
					'triggerid' => (string) $problem['objectid'],
					'name' => (string) $problem['name'],
					'opdata' => (string) ($problem['opdata'] ?? ''),
					'severity' => (int) $problem['severity'],
					'clock' => (int) $problem['clock'],
					'acknowledged' => (int) $problem['acknowledged'] === 1,
					'suppressed' => (int) ($problem['suppressed'] ?? 0) === 1
				];
			}
		}

		foreach ($result as &$rows) {
			usort($rows, static fn(array $a, array $b): int => $b['severity'] <=> $a['severity'] ?: $b['clock'] <=> $a['clock']);
		}
		unset($rows);

		return $result;
	}
}
