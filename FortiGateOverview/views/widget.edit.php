<?php declare(strict_types = 1);

/** @var CView $this */
/** @var array $data */

$form = new CWidgetFormView($data);

$form
	->addField(new CWidgetFieldMultiSelectHostView($data['fields']['hostids']))
	->addField(new CWidgetFieldTextBoxView($data['fields']['wan_regex']))
	->addField(new CWidgetFieldTextBoxView($data['fields']['expected_down_regex']))
	->addField(new CWidgetFieldNumericBoxView($data['fields']['history_hours']))
	->addField(new CWidgetFieldCheckBoxView($data['fields']['enable_auto_rotation']))
	->addField(new CWidgetFieldNumericBoxView($data['fields']['page_display_period']))
	->addFieldset(
		(new CWidgetFormFieldsetCollapsibleView(_('Visible sections')))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_overview']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_interface_map']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_interfaces']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_sdwan']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_vpn']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_ha']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_sensors']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_vdom']))
			->addField(new CWidgetFieldCheckBoxView($data['fields']['show_security']))
	)
	->addFieldset(
		(new CWidgetFormFieldsetCollapsibleView(_('Thresholds')))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['cpu_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['cpu_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['memory_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['memory_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['disk_free_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['disk_free_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['bandwidth_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['bandwidth_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['latency_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['latency_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['jitter_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['jitter_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['loss_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['loss_crit']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['temperature_warn']))
			->addField(new CWidgetFieldNumericBoxView($data['fields']['temperature_crit']))
	)
	->show();
