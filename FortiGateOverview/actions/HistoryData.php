<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        actions/HistoryData.php
** Versión:        2.0
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Acción JSON de sólo lectura: devuelve el histórico numérico de los ítems solicitados.
**                 El acceso a cada ítem se valida con item.get usando los permisos del usuario actual.
*/

namespace Modules\FortiGateOverview\Actions;

use API;
use CController;
use CControllerResponseData;
use Modules\FortiGateOverview\Includes\History;

class HistoryData extends CController {

	protected function init(): void {
		$this->disableCsrfValidation();
	}

	protected function checkInput(): bool {
		$ret = $this->validateInput([
			'itemids' => 'required|array_id',
			'hours' => 'required|int32|ge 1|le 168'
		]);

		if (!$ret) {
			$this->setResponse(new CControllerResponseData([
				'main_block' => json_encode(['error' => 'Solicitud no válida'])
			]));
		}

		return $ret;
	}

	protected function checkPermissions(): bool {
		return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
	}

	protected function doAction(): void {
		$itemids = array_slice(array_values(array_unique(array_map('strval', $this->getInput('itemids')))), 0,
			History::MAX_ITEMS
		);
		$hours = (int) $this->getInput('hours');

		$items = $itemids
			? API::Item()->get([
				'output' => ['itemid', 'value_type'],
				'itemids' => $itemids,
				'filter' => ['value_type' => [ITEM_VALUE_TYPE_FLOAT, ITEM_VALUE_TYPE_UINT64]]
			])
			: [];

		$history = $items ? History::get($items, $hours) : [];

		// Los ítems sin muestras también reciben una entrada para que el navegador no vuelva a pedirlos.
		foreach ($items as $item) {
			$history[(string) $item['itemid']] ??= [];
		}

		$this->setResponse(new CControllerResponseData([
			'main_block' => json_encode([
				'hours' => $hours,
				'generated_at' => time(),
				'history' => (object) $history
			], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
		]));
	}
}
