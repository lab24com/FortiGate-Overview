<?php declare(strict_types = 1);

namespace Modules\FortiGateOverview\Actions;

use API;
use CControllerDashboardWidgetView;
use CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {
	private array $history = [];

	private const DEFAULTS = [
		'show_overview' => 1,
		'show_interface_map' => 1,
		'show_interfaces' => 1,
		'show_sdwan' => 1,
		'show_vpn' => 1,
		'show_ha' => 1,
		'show_sensors' => 1,
		'show_vdom' => 1,
		'show_security' => 1,
		'wan_regex' => '(wan|internet|isp|outside|uplink|broadband|sdwan)',
		'expected_down_regex' => '^(ssl\.|quarantine\.|onboarding\.|fortilink)$',
		'history_hours' => 12,
		'enable_auto_rotation' => 0,
		'page_display_period' => 30,
		'cpu_warn' => 80,
		'cpu_crit' => 90,
		'memory_warn' => 80,
		'memory_crit' => 90,
		'disk_free_warn' => 20,
		'disk_free_crit' => 10,
		'bandwidth_warn' => 75,
		'bandwidth_crit' => 90,
		'latency_warn' => 100,
		'latency_crit' => 200,
		'jitter_warn' => 20,
		'jitter_crit' => 50,
		'loss_warn' => 5,
		'loss_crit' => 20,
		'temperature_warn' => 60,
		'temperature_crit' => 75
	];

	protected function doAction(): void {
		$settings = array_replace(self::DEFAULTS, $this->fields_values);
		$hostids = array_values(array_unique(array_filter(array_map('strval', $settings['hostids'] ?? []))));

		$payload = [
			'settings' => $this->publicSettings($settings),
			'hosts' => [],
			'history' => [],
			'generated_at' => time()
		];

		if ($hostids) {
			$payload['hosts'] = $this->getHostsData($hostids, $settings);
			$payload['history'] = $this->history;
		}

		$this->setResponse(new CControllerResponseData([
			'name' => $this->getInput('name', $this->widget->getName()),
			'payload' => $payload,
			'user' => ['debug_mode' => $this->getDebugMode()]
		]));
	}

	private function publicSettings(array $settings): array {
		$result = [];
		foreach (self::DEFAULTS as $key => $default) {
			$value = $settings[$key] ?? $default;
			$result[$key] = is_int($default) ? (int) $value : (string) $value;
		}
		return $result;
	}

	private function getHostsData(array $hostids, array $settings): array {
		$hosts = API::Host()->get([
			'output' => ['hostid', 'host', 'name', 'status', 'maintenance_status'],
			'hostids' => $hostids,
			'selectInterfaces' => ['interfaceid', 'ip', 'dns', 'type', 'main', 'available', 'error'],
			'preservekeys' => true
		]);

		if (!$hosts) {
			$this->history = [];
			return [];
		}

		$items = API::Item()->get([
			'output' => ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'value_type', 'state'],
			'hostids' => array_keys($hosts),
			'filter' => ['status' => 0],
			'webitems' => true
		]);

		$by_host = [];
		$history_items = [0 => [], 3 => []];
		foreach ($items as $item) {
			if (!$this->isRelevantKey($item['key_'])) {
				continue;
			}

			$hostid = (string) $item['hostid'];
			$item['itemid'] = (string) $item['itemid'];
			$item['hostid'] = $hostid;
			$item['lastclock'] = (int) $item['lastclock'];
			$item['value_type'] = (int) $item['value_type'];
			$item['state'] = (int) $item['state'];
			$by_host[$hostid][] = $item;

			if ($this->needsHistory($item)
					&& array_key_exists($item['value_type'], $history_items)) {
				$history_items[$item['value_type']][] = $item['itemid'];
			}
		}

		$history_hours = max(1, min(168, (int) $settings['history_hours']));
		$this->history = $this->getHistory($history_items, $history_hours);
		$problems = $this->getProblems(array_keys($hosts));
		$result = [];

		foreach ($hosts as $hostid => $host) {
			$hostid = (string) $hostid;
			$result[] = [
				'hostid' => $hostid,
				'name' => $host['name'],
				'technical_name' => $host['host'],
				'enabled' => (int) $host['status'] === 0,
				'maintenance' => (int) $host['maintenance_status'] === 1,
				'interfaces_meta' => $host['interfaces'],
				'items' => $by_host[$hostid] ?? [],
				'problems' => $problems[$hostid] ?? []
			];
		}

		usort($result, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
		return $result;
	}

	private function compileRegex(string $expression): string {
		$expression = trim($expression);
		if ($expression === '') {
			return '/^$/';
		}
		$regex = '~'.$expression.'~i';
		return @preg_match($regex, '') !== false ? $regex : '~(wan|internet|isp|outside|uplink|broadband|sdwan)~i';
	}

	private function isRelevantKey(string $key): bool {
		$prefixes = [
			'system.hw.', 'system.name', 'system.location', 'system.uptime', 'system.cpu.',
			'vm.memory.', 'vfs.fs.', 'net.ipv4.sessions', 'icmpping', 'zabbix[host,snmp,available]',
			'net.if.', 'vpn.', 'ips.', 'ha.', 'hw.sensor.', 'sdwan_health.', 'vdom.', 'fgate.',
			'net.tcp.service['
		];

		foreach ($prefixes as $prefix) {
			if (strncmp($key, $prefix, strlen($prefix)) === 0) {
				return true;
			}
		}
		return false;
	}

	private function needsHistory(array $item): bool {
		$key = $item['key_'];
		if (in_array($key, [
			'system.cpu.util[fgSysCpuUsage.0]',
			'vm.memory.util[memoryUsedPercentage.0]',
			'vfs.fs.pfree',
			'net.ipv4.sessions[fgSysSesCount.0]',
			'vpn.tunnel.active[fgVpnTunnelUpCount.0]',
			'vpn.users.count[fgVpnSslStatsLoginUsers.0]',
			'fgate.cpu.util',
			'fgate.memory.util',
			'fgate.fs.util'
		], true)) {
			return true;
		}

		if ((str_starts_with($key, 'sdwan_health.') || str_starts_with($key, 'fgate.sdwan_health.'))
				&& (str_contains($key, '.latency[') || str_contains($key, '.jitter[') || str_contains($key, '.loss['))) {
			return true;
		}

		// Every interface can open the historical modal from the table or interface map.
		// Limiting this to WAN interfaces left valid LAN ports (for example x4) without data.
		return strncmp($key, 'net.if.in[', 10) === 0 || strncmp($key, 'net.if.out[', 11) === 0
			|| str_starts_with($key, 'fgate.netif.in[') || str_starts_with($key, 'fgate.netif.out[');
	}

	private function getHistory(array $itemids_by_type, int $hours): array {
		$result = [];
		$time_to = time();
		$time_from = $time_to - $hours * 3600;
		$recent_from = max($time_from, $time_to - 3600);
		$all_itemids = [];

		foreach ($itemids_by_type as $history_type => $itemids) {
			$itemids = array_values(array_unique($itemids));
			if (!$itemids) {
				continue;
			}
			$all_itemids = array_merge($all_itemids, $itemids);

			$this->appendRawHistory($result, (int) $history_type, $itemids, $recent_from, $time_to, 1);
		}

		$trend_covered = [];
		$trend_first = [];
		if ($hours > 1 && $all_itemids) {
			try {
				$rows = API::Trend()->get([
					'output' => ['itemid', 'clock', 'value_min', 'value_avg', 'value_max'],
					'itemids' => array_values(array_unique($all_itemids)),
					'time_from' => $time_from,
					'time_till' => $recent_from - 1,
					'sortfield' => 'clock',
					'sortorder' => 'ASC',
					'limit' => max(5000, count($all_itemids) * ($hours + 2))
				]);

				foreach ($rows as $row) {
					$itemid = (string) $row['itemid'];
					$result[$itemid][] = [
						(int) $row['clock'] + 1800,
						(float) $row['value_avg'],
						(float) $row['value_min'],
						(float) $row['value_max']
					];
					$trend_first[$itemid] = min($trend_first[$itemid] ?? PHP_INT_MAX, (int) $row['clock']);
				}
				foreach ($trend_first as $itemid => $first_clock) {
					// The first hourly bucket may begin up to one hour after time_from.
					if ($first_clock <= $time_from + 3700) {
						$trend_covered[$itemid] = true;
					}
				}
			}
			catch (\Throwable $exception) {
				// Older or restricted frontends may not expose trend.get. Raw history below
				// remains a compatible fallback and still preserves the requested period.
			}
		}

		if ($hours > 1) {
			foreach ($itemids_by_type as $history_type => $itemids) {
				$missing = array_values(array_filter(array_unique($itemids),
					static fn(string $itemid): bool => !isset($trend_covered[$itemid])
				));
				if ($missing) {
					$this->appendRawHistory($result, (int) $history_type, $missing, $time_from, $recent_from - 1, $hours);
				}
			}
		}

		foreach ($result as $itemid => $points) {
			usort($points, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
			$result[$itemid] = $this->downsample($points, 320);
		}

		return $result;
	}

	private function appendRawHistory(array &$result, int $history_type, array $itemids,
			int $time_from, int $time_till, int $hours): void {
		if ($time_till < $time_from) {
			return;
		}

		foreach (array_chunk($itemids, 8) as $chunk) {
			$limit = max(8000, min(120000, count($chunk) * max(1, $hours) * 900));
			$rows = API::History()->get([
				'output' => ['itemid', 'clock', 'value'],
				'history' => $history_type,
				'itemids' => $chunk,
				'time_from' => $time_from,
				'time_till' => $time_till,
				'sortfield' => 'clock',
				'sortorder' => 'DESC',
				'limit' => $limit
			]);

			foreach ($rows as $row) {
				$result[(string) $row['itemid']][] = [(int) $row['clock'], (float) $row['value']];
			}
		}
	}

	private function downsample(array $points, int $maximum): array {
		$count = count($points);
		if ($count <= $maximum) {
			return $points;
		}

		$start = (int) $points[0][0];
		$end = (int) $points[$count - 1][0];
		$span = max(1, $end - $start);
		$buckets = [];

		foreach ($points as $point) {
			$index = min($maximum - 1, (int) floor(((int) $point[0] - $start) / $span * $maximum));
			$value = (float) $point[1];
			$minimum = isset($point[2]) ? (float) $point[2] : $value;
			$maximum_value = isset($point[3]) ? (float) $point[3] : $value;
			if (!isset($buckets[$index])) {
				$buckets[$index] = ['clock' => (int) $point[0], 'sum' => 0.0, 'count' => 0,
					'min' => $minimum, 'max' => $maximum_value];
			}
			$buckets[$index]['clock'] = (int) $point[0];
			$buckets[$index]['sum'] += $value;
			$buckets[$index]['count']++;
			$buckets[$index]['min'] = min($buckets[$index]['min'], $minimum);
			$buckets[$index]['max'] = max($buckets[$index]['max'], $maximum_value);
		}

		ksort($buckets);
		return array_map(static fn(array $bucket): array => [
			$bucket['clock'],
			$bucket['sum'] / $bucket['count'],
			$bucket['min'],
			$bucket['max']
		], array_values($buckets));
	}

	private function getProblems(array $hostids): array {
		$result = [];
		$rows = API::Trigger()->get([
			'output' => ['triggerid', 'description', 'priority', 'lastchange'],
			'hostids' => $hostids,
			'monitored' => true,
			'filter' => ['value' => 1],
			'expandDescription' => true,
			'sortfield' => ['priority', 'lastchange'],
			'sortorder' => 'DESC',
			'limit' => 200,
			'selectHosts' => ['hostid']
		]);

		foreach ($rows as $problem) {
			foreach ($problem['hosts'] ?? [] as $host) {
				$hostid = (string) $host['hostid'];
				$result[$hostid][] = [
					'eventid' => (string) $problem['triggerid'],
					'name' => $problem['description'],
					'severity' => (int) $problem['priority'],
					'clock' => (int) $problem['lastchange']
				];
			}
		}
		return $result;
	}
}
