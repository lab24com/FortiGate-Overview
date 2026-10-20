<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        actions/HostData.php
** Versión:        2.0
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Acción JSON de sólo lectura: devuelve todos los ítems de un firewall para la vista de
**                 detalle. El acceso al host se valida con host.get usando los permisos del usuario actual.
*/

namespace Modules\FortiGateOverview\Actions;

use API;
use CController;
use CControllerResponseData;
use Modules\FortiGateOverview\Includes\Collector;

class HostData extends CController {

	protected function init(): void {
		$this->disableCsrfValidation();
	}

	protected function checkInput(): bool {
		$ret = $this->validateInput([
			'hostid' => 'required|id'
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
		$hostid = (string) $this->getInput('hostid');
		$hosts = API::Host()->get([
			'output' => ['hostid'],
			'hostids' => [$hostid]
		]);

		if (!$hosts) {
			$output = ['error' => 'Sin permisos sobre el host o el host no existe'];
		}
		else {
			$items = Collector::getItems([$hostid], false);
			$output = [
				'hostid' => $hostid,
				'generated_at' => time(),
				'unsupported' => $items[$hostid]['unsupported'] ?? 0,
				'items' => $items[$hostid]['items'] ?? []
			];
		}

		$this->setResponse(new CControllerResponseData([
			'main_block' => json_encode($output, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
				| JSON_INVALID_UTF8_SUBSTITUTE)
		]));
	}
}
