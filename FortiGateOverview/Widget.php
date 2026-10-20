<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        Widget.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Clase principal del widget. Las traducciones de la interfaz se gestionan en
**                 assets/js/i18n.js según el idioma elegido en la configuración.
*/

namespace Modules\FortiGateOverview;

use Zabbix\Core\CWidget;

class Widget extends CWidget {

	public function getTranslationStrings(): array {
		return [
			'class.widget.js' => [
				'No data' => _('No data')
			]
		];
	}
}
