<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        views/widget.edit.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Vista del formulario de configuración: campos principales y grupos plegables de
**                 secciones y umbrales, con títulos en el idioma elegido para el widget.
*/

use Modules\FortiGateOverview\Includes\I18n;

/** @var CView $this */
/** @var array $data */

$fields = $data['fields'];
$language = I18n::normalize($fields['language']->getValue());

// Crea un grupo plegable con la vista adecuada para cada tipo de campo.
$fieldset = static function(string $title, array $names) use ($fields): CWidgetFormFieldsetCollapsibleView {
	$view = new CWidgetFormFieldsetCollapsibleView($title);

	foreach ($names as $name) {
		if (!array_key_exists($name, $fields)) {
			continue;
		}
		$field = $fields[$name];
		if ($field instanceof Zabbix\Widgets\Fields\CWidgetFieldCheckBox) {
			$view->addField(new CWidgetFieldCheckBoxView($field));
		}
		elseif ($field instanceof Zabbix\Widgets\Fields\CWidgetFieldTextBox) {
			$view->addField(new CWidgetFieldTextBoxView($field));
		}
		else {
			$view->addField(new CWidgetFieldNumericBoxView($field));
		}
	}

	return $view;
};

(new CWidgetFormView($data))
	->addField(new CWidgetFieldSelectView($fields['language']))
	->addField(new CWidgetFieldMultiSelectGroupView($fields['groupids']))
	->addField(new CWidgetFieldMultiSelectHostView($fields['hostids']))
	->addField(new CWidgetFieldNumericBoxView($fields['max_hosts']))
	->addField(new CWidgetFieldTextBoxView($fields['wan_regex']))
	->addField(new CWidgetFieldTextBoxView($fields['expected_down_regex']))
	->addField(new CWidgetFieldNumericBoxView($fields['history_hours']))
	->addField(new CWidgetFieldCheckBoxView($fields['enable_auto_rotation']))
	->addField(new CWidgetFieldNumericBoxView($fields['page_display_period']))
	->addFieldset($fieldset(I18n::label('fieldset_sections', $language), [
		'show_fleet', 'show_overview', 'show_interface_map', 'show_problems', 'show_interfaces', 'show_sdwan',
		'show_vpn', 'show_security', 'show_ha', 'show_policies', 'show_licenses', 'show_wireless', 'show_sensors',
		'show_vdom', 'show_system'
	]))
	->addFieldset($fieldset(I18n::label('fieldset_resources', $language), [
		'cpu_warn', 'cpu_crit', 'memory_warn', 'memory_crit', 'disk_free_warn', 'disk_free_crit',
		'bandwidth_warn', 'bandwidth_crit', 'temperature_warn', 'temperature_crit'
	]))
	->addFieldset($fieldset(I18n::label('fieldset_availability', $language), [
		'icmp_loss_warn', 'icmp_loss_crit', 'icmp_rtt_warn', 'icmp_rtt_crit', 'latency_warn', 'latency_crit',
		'jitter_warn', 'jitter_crit', 'loss_warn', 'loss_crit'
	]))
	->addFieldset($fieldset(I18n::label('fieldset_lifecycle', $language), [
		'license_warn_days', 'license_crit_days', 'policy_unused_days', 'stale_minutes'
	]))
	->show();
