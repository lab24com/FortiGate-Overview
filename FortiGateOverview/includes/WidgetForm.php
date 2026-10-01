<?php declare(strict_types = 1);

namespace Modules\FortiGateOverview\Includes;

use Zabbix\Widgets\CWidgetField;
use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectHost;
use Zabbix\Widgets\Fields\CWidgetFieldNumericBox;
use Zabbix\Widgets\Fields\CWidgetFieldTextBox;

class WidgetForm extends CWidgetForm {

	public function addFields(): self {
		return $this
			->addField(
				(new CWidgetFieldMultiSelectHost('hostids', _('FortiGate hosts')))
					->setFlags(CWidgetField::FLAG_NOT_EMPTY | CWidgetField::FLAG_LABEL_ASTERISK)
			)
			->addField((new CWidgetFieldTextBox('wan_regex', _('WAN interface regular expression')))
				->setDefault('(wan|internet|isp|outside|uplink|broadband|sdwan)'))
			->addField((new CWidgetFieldTextBox('expected_down_regex', _('Expected DOWN interface regular expression')))
				->setDefault('^(ssl\\.|quarantine\\.|onboarding\\.|fortilink)$'))
			->addField((new CWidgetFieldNumericBox('history_hours', _('History period (hours)')))->setDefault(12))
			->addField((new CWidgetFieldCheckBox('enable_auto_rotation', _('Enable automatic firewall rotation')))->setDefault(0))
			->addField((new CWidgetFieldNumericBox('page_display_period', _('Firewall display period (seconds, 0 = off)')))->setDefault(30))

			->addField((new CWidgetFieldCheckBox('show_overview', _('Show overview')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_interface_map', _('Show interface map in overview')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_interfaces', _('Show network interfaces')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_sdwan', _('Show SD-WAN')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_vpn', _('Show VPN')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_ha', _('Show HA cluster')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_sensors', _('Show hardware sensors')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_vdom', _('Show VDOM')))->setDefault(1))
			->addField((new CWidgetFieldCheckBox('show_security', _('Show IPS security counters')))->setDefault(1))

			->addField((new CWidgetFieldNumericBox('cpu_warn', _('CPU warning (%)')))->setDefault(80))
			->addField((new CWidgetFieldNumericBox('cpu_crit', _('CPU critical (%)')))->setDefault(90))
			->addField((new CWidgetFieldNumericBox('memory_warn', _('Memory warning (%)')))->setDefault(80))
			->addField((new CWidgetFieldNumericBox('memory_crit', _('Memory critical (%)')))->setDefault(90))
			->addField((new CWidgetFieldNumericBox('disk_free_warn', _('Disk free warning (%)')))->setDefault(20))
			->addField((new CWidgetFieldNumericBox('disk_free_crit', _('Disk free critical (%)')))->setDefault(10))
			->addField((new CWidgetFieldNumericBox('bandwidth_warn', _('WAN utilization warning (%)')))->setDefault(75))
			->addField((new CWidgetFieldNumericBox('bandwidth_crit', _('WAN utilization critical (%)')))->setDefault(90))
			->addField((new CWidgetFieldNumericBox('latency_warn', _('SD-WAN latency warning (ms)')))->setDefault(100))
			->addField((new CWidgetFieldNumericBox('latency_crit', _('SD-WAN latency critical (ms)')))->setDefault(200))
			->addField((new CWidgetFieldNumericBox('jitter_warn', _('SD-WAN jitter warning (ms)')))->setDefault(20))
			->addField((new CWidgetFieldNumericBox('jitter_crit', _('SD-WAN jitter critical (ms)')))->setDefault(50))
			->addField((new CWidgetFieldNumericBox('loss_warn', _('SD-WAN packet loss warning (%)')))->setDefault(5))
			->addField((new CWidgetFieldNumericBox('loss_crit', _('SD-WAN packet loss critical (%)')))->setDefault(20))
			->addField((new CWidgetFieldNumericBox('temperature_warn', _('Temperature warning (°C)')))->setDefault(60))
			->addField((new CWidgetFieldNumericBox('temperature_crit', _('Temperature critical (°C)')))->setDefault(75));
	}
}
