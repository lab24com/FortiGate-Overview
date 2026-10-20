<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        includes/History.php
** Versión:        2.0
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Lectura del histórico numérico. La última hora se lee del histórico; los periodos
**                 anteriores usan tendencias horarias (mín/prom/máx) con respaldo al histórico cuando un ítem no
**                 tiene tendencias. Cada serie se reduce a MAX_POINTS intervalos conservando mínimo y máximo.
*/

namespace Modules\FortiGateOverview\Includes;

use API;

final class History {

	public const MAX_POINTS = 320;
	public const MAX_ITEMS = 80;

	/**
	 * Histórico de los ítems indicados para el periodo solicitado.
	 *
	 * @param array $items  [['itemid' => string, 'value_type' => int], ...]
	 *
	 * @return array  itemid => [[clock, promedio, mínimo, máximo], ...]
	 */
	public static function get(array $items, int $hours): array {
		$hours = max(1, min(168, $hours));
		$by_type = [0 => [], 3 => []];

		foreach ($items as $item) {
			$type = (int) $item['value_type'];
			if (array_key_exists($type, $by_type)) {
				$by_type[$type][] = (string) $item['itemid'];
			}
		}

		$result = [];
		$time_to = time();
		$time_from = $time_to - $hours * 3600;
		$recent_from = max($time_from, $time_to - 3600);
		$all_itemids = [];

		foreach ($by_type as $history_type => $itemids) {
			$itemids = array_values(array_unique($itemids));
			if (!$itemids) {
				continue;
			}
			$all_itemids = array_merge($all_itemids, $itemids);
			self::appendRaw($result, $history_type, $itemids, $recent_from, $time_to, 1);
		}

		$trend_covered = [];
		if ($hours > 1 && $all_itemids) {
			$trend_first = [];
			try {
				$rows = API::Trend()->get([
					'output' => ['itemid', 'clock', 'value_min', 'value_avg', 'value_max'],
					'itemids' => array_values(array_unique($all_itemids)),
					'time_from' => $time_from,
					'time_till' => $recent_from - 1,
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
					// El primer intervalo horario puede comenzar hasta una hora después de time_from.
					if ($first_clock <= $time_from + 3700) {
						$trend_covered[$itemid] = true;
					}
				}
			}
			catch (\Throwable $exception) {
				// trend.get no disponible: el histórico directo de abajo cubre el periodo solicitado.
			}

			foreach ($by_type as $history_type => $itemids) {
				$missing = array_values(array_filter(array_unique($itemids),
					static fn(string $itemid): bool => !isset($trend_covered[$itemid])
				));
				if ($missing) {
					// Se descartan tendencias parciales para que no se superpongan con el histórico directo.
					foreach ($missing as $itemid) {
						if (isset($result[$itemid])) {
							$result[$itemid] = array_values(array_filter($result[$itemid],
								static fn(array $point): bool => count($point) < 4
							));
						}
					}
					self::appendRaw($result, $history_type, $missing, $time_from, $recent_from - 1, $hours);
				}
			}
		}

		foreach ($result as $itemid => $points) {
			usort($points, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
			$result[$itemid] = self::downsample($points, self::MAX_POINTS);
		}

		return $result;
	}

	private static function appendRaw(array &$result, int $history_type, array $itemids, int $time_from,
			int $time_till, int $hours): void {
		if ($time_till < $time_from) {
			return;
		}

		// Grupos pequeños evitan que el límite global de búsqueda corte las muestras más antiguas.
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

	private static function downsample(array $points, int $maximum): array {
		$count = count($points);
		if ($count <= $maximum) {
			return array_map(static fn(array $p): array => [
				(int) $p[0],
				round((float) $p[1], 4),
				round((float) ($p[2] ?? $p[1]), 4),
				round((float) ($p[3] ?? $p[1]), 4)
			], $points);
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
			round($bucket['sum'] / $bucket['count'], 4),
			round($bucket['min'], 4),
			round($bucket['max'], 4)
		], array_values($buckets));
	}
}
