<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        actions/WidgetView.php
** Versión:        2.0
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Controlador de datos del dashboard. Hasta FULL_DETAIL_HOSTS firewalls se envían con
**                 todos sus ítems; selecciones mayores se envían en modo ligero (resumen de flota) y el navegador
**                 carga el detalle con laka.fortigate.host y el histórico con laka.fortigate.history.
*/

namespace Modules\FortiGateOverview\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;
use Modules\FortiGateOverview\Includes\Collector;
use Modules\FortiGateOverview\Includes\Defaults;

class WidgetView extends CControllerDashboardWidgetView {

	private const FULL_DETAIL_HOSTS = 3;

	protected function doAction(): void {
		$settings = Defaults::merge($this->fields_values);
		$settings['max_hosts'] = max(1, min(1000, $settings['max_hosts']));
		$settings['history_hours'] = max(1, min(168, $settings['history_hours']));

		$payload = [
			'settings' => $settings,
			'hosts' => [],
			'truncated' => false,
			'generated_at' => time()
		];

		[$hostids, $explicit] = $this->resolveHostIds($settings['max_hosts']);

		if ($hostids) {
			[$payload['hosts'], $payload['truncated']] = $this->getHostsData($hostids, $explicit, $settings['max_hosts']);
		}

		$this->setResponse(new CControllerResponseData([
			'name' => $this->getInput('name', $this->widget->getName()),
			'payload' => $payload,
			'user' => ['debug_mode' => $this->getDebugMode()]
		]));
	}

	/**
	 * Resuelve los hosts del widget: seleccionados uno por uno y miembros de los grupos elegidos.
	 *
	 * @return array  [hostids, conjunto de hostids seleccionados explícitamente]
	 */
	private function resolveHostIds(int $limit): array {
		$explicit = array_values(array_unique(array_filter(array_map('strval', $this->fields_values['hostids'] ?? []))));
		$groupids = array_values(array_unique(array_filter(array_map('strval', $this->fields_values['groupids'] ?? []))));
		$hostids = $explicit;

		if ($groupids) {
			if (function_exists('getSubGroups')) {
				$groupids = getSubGroups($groupids);
			}

			// Los grupos pueden contener hosts que no son FortiGate: se lee un margen y luego se filtra por datos de plantilla.
			$group_hosts = API::Host()->get([
				'output' => ['hostid'],
				'groupids' => $groupids,
				'sortfield' => 'name',
				'limit' => $limit * 3,
				'preservekeys' => true
			]);
			$hostids = array_values(array_unique(array_merge($hostids, array_map('strval', array_keys($group_hosts)))));
		}

		return [$hostids, array_flip($explicit)];
	}

	private function getHostsData(array $hostids, array $explicit, int $limit): array {
		$hosts = API::Host()->get([
			'output' => ['hostid', 'host', 'name', 'status', 'maintenance_status'],
			'hostids' => $hostids,
			'selectInterfaces' => ['ip', 'dns', 'useip', 'type', 'main', 'available'],
			'selectHostGroups' => ['name'],
			'preservekeys' => true
		]);

		if (!$hosts) {
			return [[], false];
		}

		$light = count($hosts) > self::FULL_DETAIL_HOSTS;
		$items = Collector::getItems(array_keys($hosts), $light);
		$rows = [];

		foreach ($hosts as $hostid => $host) {
			$hostid = (string) $hostid;
			$host_items = $items[$hostid]['items'] ?? [];

			// Los hosts que sólo provienen de un grupo deben tener datos de las plantillas FortiGate.
			if (!array_key_exists($hostid, $explicit) && !Collector::isFortiGate($host_items)) {
				continue;
			}

			$rows[$hostid] = [
				'hostid' => $hostid,
				'name' => $host['name'],
				'technical_name' => $host['host'],
				'enabled' => (int) $host['status'] === 0,
				'maintenance' => (int) $host['maintenance_status'] === 1,
				'groups' => array_values(array_map(static fn(array $g): string => $g['name'], $host['hostgroups'] ?? [])),
				'interfaces_meta' => array_values($host['interfaces'] ?? []),
				'detail' => !$light,
				'unsupported' => $items[$hostid]['unsupported'] ?? 0,
				'items' => $host_items,
				'problems' => []
			];
		}

		uasort($rows, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
		$truncated = count($rows) > $limit;
		$rows = array_slice($rows, 0, $limit, true);

		foreach (Collector::getProblems(array_keys($rows)) as $hostid => $problems) {
			if (array_key_exists($hostid, $rows)) {
				$rows[$hostid]['problems'] = $problems;
			}
		}

		return [array_values($rows), $truncated];
	}
}
