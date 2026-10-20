<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        includes/WidgetForm.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Campos del formulario de configuración del widget. Las etiquetas se muestran en el
**                 idioma elegido para el widget (o en el idioma del usuario si aún no se eligió).
*/

namespace Modules\FortiGateOverview\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectHost;
use Zabbix\Widgets\Fields\CWidgetFieldNumericBox;
use Zabbix\Widgets\Fields\CWidgetFieldSelect;
use Zabbix\Widgets\Fields\CWidgetFieldTextBox;

class WidgetForm extends CWidgetForm {

	/** Campos numéricos (umbrales, límites y periodos). */
	private const NUMBERS = [
		'max_hosts', 'history_hours', 'page_display_period',
		'cpu_warn', 'cpu_crit', 'memory_warn', 'memory_crit', 'disk_free_warn', 'disk_free_crit',
		'bandwidth_warn', 'bandwidth_crit', 'temperature_warn', 'temperature_crit',
		'icmp_loss_warn', 'icmp_loss_crit', 'icmp_rtt_warn', 'icmp_rtt_crit',
		'latency_warn', 'latency_crit', 'jitter_warn', 'jitter_crit', 'loss_warn', 'loss_crit',
		'license_warn_days', 'license_crit_days', 'policy_unused_days', 'stale_minutes'
	];

	/** Casillas de verificación (rotación y secciones visibles). */
	private const CHECKBOXES = [
		'enable_auto_rotation',
		'show_fleet', 'show_overview', 'show_interface_map', 'show_problems', 'show_interfaces', 'show_sdwan',
		'show_vpn', 'show_security', 'show_ha', 'show_policies', 'show_licenses', 'show_wireless', 'show_sensors',
		'show_vdom', 'show_system'
	];

	public function addFields(): self {
		$defaults = Defaults::SETTINGS;
		$language = $this->language();
		$label = static fn(string $name): string => I18n::label($name, $language);

		$this
			->addField(
				(new CWidgetFieldSelect('language', $label('language'), I18n::LANGUAGES))
					->setDefault(I18n::userLanguage())
			)
			->addField(new CWidgetFieldMultiSelectGroup('groupids', $label('groupids')))
			->addField(new CWidgetFieldMultiSelectHost('hostids', $label('hostids')))
			->addField((new CWidgetFieldTextBox('wan_regex', $label('wan_regex')))->setDefault($defaults['wan_regex']))
			->addField((new CWidgetFieldTextBox('expected_down_regex', $label('expected_down_regex')))
				->setDefault($defaults['expected_down_regex'])
			);

		foreach (self::NUMBERS as $name) {
			$this->addField((new CWidgetFieldNumericBox($name, $label($name)))->setDefault($defaults[$name]));
		}

		foreach (self::CHECKBOXES as $name) {
			$this->addField((new CWidgetFieldCheckBox($name, $label($name)))->setDefault($defaults[$name]));
		}

		return $this;
	}

	/**
	 * Idioma guardado en el widget; si todavía no existe, el idioma del usuario de Zabbix.
	 */
	private function language(): int {
		return I18n::normalize($this->values['language'] ?? null);
	}
}
