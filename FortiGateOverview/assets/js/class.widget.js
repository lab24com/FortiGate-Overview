class WidgetLakaFortiGateOverview extends CWidget {

	onInitialize() {
		super.onInitialize();
		this._selected_hostid = null;
		this._selected_tab = 'overview';
		this._payload = null;
		this._modal = null;
		this._modalResizeHandler = null;
		this._sidebar_collapsed = false;
		this._rotationTimer = null;
	}

	setContents(response) {
		super.setContents(response);
		this._renderWidget();
		this._restartHostRotation();
	}

	onResize() {
		super.onResize();
		window.requestAnimationFrame(() => this._drawAllCharts());
	}

	onClearContents() {
		this._stopHostRotation();
		this._closeModal();
		super.onClearContents();
	}

	_renderWidget() {
		const root = this._body.querySelector('.laka-fortigate-root');
		if (!root) return;

		try {
			this._payload = JSON.parse(decodeURIComponent(escape(atob(root.dataset.payload))));
		}
		catch (error) {
			root.innerHTML = `<div class="fg-empty">No se pudo interpretar la información del widget.</div>`;
			return;
		}

		const hosts = this._payload.hosts || [];
		if (!hosts.length) {
			root.innerHTML = `<div class="fg-empty"><strong>Seleccione al menos un FortiGate.</strong><span>Edite el widget y elija los hosts vinculados con la plantilla oficial FortiGate by HTTP o by SNMP.</span></div>`;
			return;
		}

		if (!hosts.some(host => host.hostid === this._selected_hostid)) {
			this._selected_hostid = hosts[0].hostid;
		}

		const rotationEnabled = Number(this._payload.settings.enable_auto_rotation) === 1;
		const rotation = Math.max(0, Number(this._payload.settings.page_display_period) || 0);
		const effectiveRotation = rotationEnabled && rotation > 0 ? Math.max(5, Math.min(3600, rotation)) : 0;
		root.innerHTML = `
			<div class="fg-shell ${this._sidebar_collapsed ? 'is-sidebar-collapsed' : ''}">
				<aside class="fg-sidebar">
					<div class="fg-sidebar-top"><div class="fg-brand"><span class="fg-shield">F</span><div><strong>FortiGate</strong><small>Security Operations</small></div></div><button class="fg-sidebar-toggle" title="${this._sidebar_collapsed ? 'Ampliar menú' : 'Plegar menú'}">${this._sidebar_collapsed ? '›' : '‹'}</button></div>
					<label class="fg-search"><span>⌕</span><input type="search" placeholder="Buscar firewall…"></label>
					<div class="fg-host-list">${hosts.map(host => this._hostButton(host)).join('')}</div>
					<div class="fg-rotation" title="Periodo de visualización automática"><span>↻</span><b>${effectiveRotation > 0 && hosts.length > 1 ? `${effectiveRotation}s` : 'OFF'}</b><small>Rotación automática</small></div>
				</aside>
				<main class="fg-main"></main>
			</div>`;

		root.querySelectorAll('.fg-host').forEach(button => button.addEventListener('click', () => {
			this._selected_hostid = button.dataset.hostid;
			this._selected_tab = 'overview';
			this._renderWidget();
			this._restartHostRotation();
		}));

		root.querySelector('.fg-sidebar-toggle').addEventListener('click', () => {
			this._sidebar_collapsed = !this._sidebar_collapsed;
			this._renderWidget();
		});

		root.querySelector('.fg-search input').addEventListener('input', event => {
			const needle = event.target.value.toLowerCase();
			root.querySelectorAll('.fg-host').forEach(button => {
				button.hidden = !button.textContent.toLowerCase().includes(needle);
			});
		});

		this._renderHost(root.querySelector('.fg-main'));
	}

	_hostButton(host) {
		const data = this._prepare(host);
		const buckets = this._problemBuckets(host, data);
		const health = this._hostHealth(host, buckets.active);
		const model = this._pick(host, ['system.hw.model', 'fgate.device.model'], /device model|hardware model/i)?.lastvalue || 'FortiGate';
		return `<button class="fg-host ${host.hostid === this._selected_hostid ? 'is-active' : ''}" data-hostid="${this._e(host.hostid)}" title="${this._e(host.name)} · ${this._e(model)}">
			<span class="fg-dot ${health.level}"></span><span class="fg-host-info"><strong>${this._e(host.name)}</strong><small>${this._e(model)} · ${this._e(health.label)}</small></span>
			${buckets.active.length ? `<b class="fg-count">${buckets.active.length}</b>` : buckets.recovered.length ? `<b class="fg-count recovered" title="${buckets.recovered.length} eventos recuperados pendientes de cierre">✓</b>` : ''}
		</button>`;
	}

	_renderHost(container) {
		const host = this._payload.hosts.find(row => row.hostid === this._selected_hostid);
		const data = this._prepare(host);
		const settings = this._payload.settings;
		const buckets = this._problemBuckets(host, data);
		const tabs = this._tabs(data, settings);
		if (!tabs.some(tab => tab.id === this._selected_tab)) this._selected_tab = tabs[0]?.id || 'overview';

		const health = this._hostHealth(host, buckets.active);
		const address = (host.interfaces_meta || []).find(row => String(row.main) === '1' && String(row.type) === '2')
			|| (host.interfaces_meta || [])[0];
		container.innerHTML = `
			<header class="fg-header">
				<div class="fg-title"><span class="fg-status-icon ${health.level}">◆</span><div><h2>${this._e(host.name)}</h2><p>${this._e(data.model || host.technical_name)} · ${this._e(data.firmware || 'FortiOS sin datos')} · ${this._e(address ? (address.ip || address.dns) : '')} <span class="fg-source">${this._e(data.source)}</span></p></div></div>
				<div class="fg-header-actions"><span class="fg-health ${health.level}">${this._e(health.label)}</span><a href="zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=${this._e(host.hostid)}" target="_blank">Problemas ${buckets.active.length}</a><a href="zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=${this._e(host.hostid)}" target="_blank">Últimos datos</a></div>
			</header>
			<nav class="fg-tabs">${tabs.map(tab => `<button data-tab="${tab.id}" class="${this._selected_tab === tab.id ? 'is-active' : ''}">${tab.icon}<span>${tab.label}</span>${tab.count !== null ? `<b>${tab.count}</b>` : ''}</button>`).join('')}</nav>
			<section class="fg-content">${this._tabContent(this._selected_tab, data, host, settings)}</section>
			<footer class="fg-footer"><span>Actualizado ${this._age(this._payload.generated_at)}</span><span>Vista: 1 h · histórico disponible: ${settings.history_hours} h</span></footer>`;

		container.querySelectorAll('.fg-tabs button').forEach(button => button.addEventListener('click', () => {
			this._selected_tab = button.dataset.tab;
			this._renderHost(container);
		}));
		container.querySelectorAll('[data-chart-items]').forEach(element => element.addEventListener('click', () => {
			this._openChart(element.dataset.chartTitle, element.dataset.chartItems.split(','), element.dataset.chartUnits || '');
		}));
		container.querySelectorAll('[data-if-filter]').forEach(button => button.addEventListener('click', () => {
			const map = button.closest('.fg-interface-map');
			if (!map) return;
			map.querySelectorAll('[data-if-filter]').forEach(candidate => candidate.classList.toggle('is-active', candidate === button));
			const filter = button.dataset.ifFilter;
			map.querySelectorAll('.fg-port').forEach(port => {
				port.hidden = filter !== 'all' && !(port.dataset.ifTags || '').split(' ').includes(filter);
			});
		}));
		this._bindWanEditor(container, host, data);
		this._bindInterfaceEditor(container, host);
		window.requestAnimationFrame(() => this._drawAllCharts());
	}

	_tabs(data, settings) {
		const tabs = [];
		if (settings.show_overview) tabs.push({id: 'overview', label: 'Resumen', icon: '◈', count: null});
		if (settings.show_interfaces) tabs.push({id: 'interfaces', label: 'Interfaces', icon: '⇄', count: data.interfaces.length});
		if (settings.show_sdwan && data.sdwan.length) tabs.push({id: 'sdwan', label: 'SD-WAN', icon: '⌁', count: data.sdwan.length});
		if (settings.show_vpn && (data.vpns.length || data.vpn_active || data.vpn_users)) tabs.push({id: 'vpn', label: 'VPN', icon: '◇', count: data.vpns.length});
		if (settings.show_security && data.security.length) tabs.push({id: 'security', label: 'Seguridad', icon: '⬡', count: null});
		if (settings.show_ha && data.ha.length) tabs.push({id: 'ha', label: 'HA', icon: '⛓', count: data.ha.length});
		if (settings.show_sensors && data.sensors.length) tabs.push({id: 'sensors', label: 'Sensores', icon: '♨', count: data.sensors.length});
		if (settings.show_vdom && data.vdom.length) tabs.push({id: 'vdom', label: 'VDOM', icon: '▦', count: data.vdom.length});
		return tabs;
	}

	_tabContent(tab, data, host, settings) {
		switch (tab) {
			case 'interfaces': return this._interfacesView(data, settings);
			case 'sdwan': return this._sdwanView(data, settings);
			case 'vpn': return this._vpnView(data);
			case 'security': return this._securityView(data);
			case 'ha': return this._haView(data);
			case 'sensors': return this._sensorsView(data, settings);
			case 'vdom': return this._vdomView(data);
			default: return this._overviewView(data, host, settings);
		}
	}

	_overviewView(data, host, settings) {
		const buckets = this._problemBuckets(host, data);
		const cpu = this._num(data.cpu);
		const memory = this._num(data.memory_util);
		const free = this._num(data.disk_free_pct);
		const used = this._num(data.disk_util) !== null ? this._num(data.disk_util) : free === null ? null : 100 - free;
		const memoryTotal = this._num(data.memory_total);
		const memoryUsed = this._num(data.memory_used) ?? (memoryTotal !== null && memory !== null ? memoryTotal * memory / 100 : null);
		const wan = data.interfaces.filter(row => row.is_wan);
		const kpis = [
			this._metricCard('CPU', cpu, '%', settings.cpu_warn, settings.cpu_crit, data.cpu, 'Uso de CPU'),
			this._metricCard('Memoria', memory, '%', settings.memory_warn, settings.memory_crit, data.memory_util, 'Uso de memoria', `${this._bytes(memoryUsed)} / ${this._bytes(memoryTotal)}`),
			this._metricCard('Disco utilizado', used, '%', 100-settings.disk_free_warn, 100-settings.disk_free_crit, data.disk_util || data.disk_free_pct, 'Espacio de disco', `${this._bytes(this._num(data.disk_free))} libres`)
		];
		if (data.sessions) kpis.push(this._numberCard('Sesiones activas', this._num(data.sessions), data.sessions, 'Sesiones IPv4'));
		if (settings.show_vpn && data.vpn_active) kpis.push(this._numberCard('VPN IPsec', this._num(data.vpn_active), data.vpn_active, 'Túneles activos'));
		if (settings.show_vpn && data.vpn_users) kpis.push(this._numberCard('Usuarios SSL-VPN', this._num(data.vpn_users), data.vpn_users, 'Usuarios conectados'));
		return `
			<div class="fg-kpis">${kpis.join('')}</div>
			${settings.show_interface_map && data.interfaces.length ? this._interfaceMap(data, settings) : ''}
			<div class="fg-two-columns ${wan.length ? '' : 'no-wan'}">
				<article class="fg-panel fg-wan-panel"><div class="fg-panel-title"><div><h3>Consumo de interfaces WAN</h3><p>Entrada y salida durante la última hora · clic para ampliar</p></div><div class="fg-panel-actions"><span class="fg-chip">${wan.length} WAN</span><button class="fg-config-button" data-wan-editor-toggle title="Personalizar las interfaces WAN únicamente para ${this._e(host.name)}">⚙ Configurar WAN</button></div></div>
					<div class="fg-wan-editor" hidden><label>Interfaces adicionales de <strong>${this._e(host.name)}</strong><input type="text" data-wan-editor-input value="${this._e([...this._hostWanSet(host.hostid)].join(', '))}" placeholder="port1, port12, x4"></label><small>Separe los nombres con comas. Esta selección sólo afecta a este firewall y se conserva al recargar.</small><div><button data-wan-editor-save>Guardar</button><button data-wan-editor-clear>Limpiar</button><button data-wan-editor-cancel>Cancelar</button></div></div>
					${wan.length ? wan.map(row => this._wanCard(row, settings)).join('') : this._empty('No se identificaron interfaces WAN', 'Agregue sus nombres o ajuste la expresión WAN en la configuración del widget.')}
				</article>
				<article class="fg-panel"><div class="fg-panel-title"><div><h3>Estado operativo</h3><p>Disponibilidad, plataforma y eventos</p></div></div>
					<div class="fg-facts">
						${this._fact('ICMP', this._num(data.ping) === null ? 'Sin datos' : this._num(data.ping) === 1 ? 'Disponible' : 'No disponible', this._num(data.ping) === 1 ? 'ok' : this._num(data.ping) === 0 ? 'crit' : 'neutral')}
						${this._fact(data.source === 'HTTP API' ? 'API HTTP' : 'SNMP', this._num(data.collector) === null ? 'Sin datos' : this._num(data.collector) === 1 ? 'Disponible' : 'Sin respuesta', this._num(data.collector) === 1 ? 'ok' : this._num(data.collector) === 0 ? 'crit' : 'neutral')}
						${this._fact('Modo HA', this._haMode(data.ha_mode), 'neutral')}
						${this._fact('Uptime', this._uptime(this._num(data.uptime)), 'neutral')}
						${this._fact('Serial', data.serial || 'Sin datos', 'neutral')}
						${this._fact('Problemas actuales', String(buckets.active.length), buckets.active.length ? 'warn' : 'ok')}
					</div>
					${buckets.active.length ? `<div class="fg-problems">${buckets.active.slice(0, 5).map(p => this._problemRow(p, data)).join('')}</div>` : '<div class="fg-all-good">✓ Sin problemas operativos actuales</div>'}
					${buckets.recovered.length ? `<details class="fg-recovered-group"><summary>${buckets.recovered.length} evento${buckets.recovered.length === 1 ? '' : 's'} recuperado${buckets.recovered.length === 1 ? '' : 's'} · pendiente${buckets.recovered.length === 1 ? '' : 's'} de cierre en Zabbix</summary><div class="fg-problems">${buckets.recovered.slice(0, 8).map(p => this._problemRow(p, data)).join('')}</div></details>` : ''}
				</article>
			</div>`;
	}

	_interfaceMap(data, settings) {
		const rows = [...data.interfaces].sort((a, b) => this._naturalCompare(a.name, b.name));
		const states = rows.map(row => ({row, state: this._interfaceStatus(row.status, row)}));
		const up = states.filter(entry => entry.state.class.split(' ').includes('up')).length;
		const expected = states.filter(entry => entry.state.class === 'expected').length;
		const down = states.filter(entry => ['down', 'not-present', 'lower-down'].includes(entry.state.class)).length;
		const errors = rows.filter(row => (this._num(row.in_errors) || 0) + (this._num(row.out_errors) || 0) > 0).length;
		return `<article class="fg-panel fg-wide fg-interface-map">
			<div class="fg-panel-title fg-map-title"><div><h3>Mapa de interfaces</h3><p>Estado actual, tráfico y función de cada puerto · clic para abrir el histórico</p></div>
				<div class="fg-map-controls"><div class="fg-map-summary"><span><i class="up"></i>${up} UP</span><span><i class="down"></i>${down} DOWN</span><span><i class="expected"></i>${expected} esperadas</span><span><i class="errors"></i>${errors} con errores</span>${data.hidden_interfaces ? `<span>${data.hidden_interfaces} ocultas</span>` : ''}${data.grouped_interfaces ? `<span>${data.grouped_interfaces} agrupadas</span>` : ''}</div><button class="fg-config-button" data-interface-editor-toggle>⚙ Filtrar mapa</button></div>
			</div>
			${this._interfaceEditor(data)}
			<div class="fg-map-filters">
				${[['up','UP'],['all','Todas'],['physical','Físicas'],['wan','WAN'],['sdwan','SD-WAN'],['down','DOWN'],['traffic','Con tráfico'],['errors','Con errores']].map(([id,label]) => `<button data-if-filter="${id}" class="${id === 'up' ? 'is-active' : ''}">${label}</button>`).join('')}
			</div>
			<div class="fg-port-grid">${rows.map(row => this._portCard(row, settings)).join('')}</div>
			<div class="fg-map-legend"><span><i class="up"></i>Operativa</span><span><i class="idle"></i>UP sin tráfico</span><span><i class="down"></i>Falla</span><span><i class="expected"></i>DOWN esperado</span><span><i class="wan"></i>WAN</span><span><i class="sdwan"></i>SD-WAN</span></div>
		</article>`;
	}

	_portCard(row, settings) {
		const state = this._interfaceStatus(row.status, row);
		const input = this._num(row.in), output = this._num(row.out), speed = this._num(row.speed);
		const traffic = Math.max(input || 0, output || 0);
		const errors = (this._num(row.in_errors) || 0) + (this._num(row.out_errors) || 0);
		const util = speed ? traffic / speed * 100 : null;
		const level = this._levelHigh(util, settings.bandwidth_warn, settings.bandwidth_crit);
		const ids = [row.in?.itemid, row.out?.itemid].filter(Boolean);
		const stateClass = state.class.split(' ')[0];
		const tags = ['all', row.is_physical ? 'physical' : 'virtual', row.is_wan ? 'wan' : '', row.is_sdwan ? 'sdwan' : '', stateClass === 'up' ? 'up' : ['down','not-present','lower-down'].includes(stateClass) ? 'down' : stateClass, traffic > 0 ? 'traffic' : '', errors > 0 ? 'errors' : ''].filter(Boolean).join(' ');
		const title = `${row.name}${row.alias ? ` · ${row.alias}` : ''}${row.duplicate_count > 1 ? `\n${row.duplicate_count} índices SNMP agrupados` : ''}\n${state.label} · ${state.detail}\n↓ ${this._bits(input)} · ↑ ${this._bits(output)}\nVelocidad ${this._bits(speed)} · Utilización ${util === null ? '—' : this._fmt(util)+'%'}\nErrores ${this._compact(errors)}`;
		return `<button class="fg-port ${stateClass} ${traffic > 0 ? 'has-traffic' : 'is-idle'} ${row.is_wan ? 'is-wan' : ''} ${row.is_sdwan ? 'is-sdwan' : ''} ${level}" data-if-tags="${tags}" title="${this._e(title)}" ${stateClass === 'up' ? '' : 'hidden'} ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="Interfaz ${this._e(row.name)}" data-chart-units="bps"` : 'disabled'}>
			<span class="fg-port-top"><strong>${this._e(row.name)}</strong>${row.duplicate_count > 1 ? `<em>×${row.duplicate_count}</em>` : ''}${row.is_wan ? '<b>WAN</b>' : row.is_sdwan ? '<b>SD</b>' : ''}</span>
			<span class="fg-port-jack"><i></i><i></i><i></i><i></i><i></i><i></i></span>
			<small>${this._e(row.alias || (row.is_physical ? 'Puerto físico' : 'Interfaz lógica'))}</small>
			<span class="fg-port-rate">↓ ${this._bits(input)}<br>↑ ${this._bits(output)}</span>
		</button>`;
	}

	_metricCard(label, value, unit, warn, crit, item, title, detail = '') {
		const level = this._levelHigh(value, warn, crit);
		const itemid = item?.itemid || '';
		return `<button class="fg-kpi ${level}" ${itemid ? `data-chart-items="${itemid}" data-chart-title="${this._e(title)}" data-chart-units="${unit}"` : ''}>
			<div class="fg-kpi-head"><span>${label}</span><b class="fg-dot ${level}"></b></div><strong>${value === null ? '—' : this._fmt(value)}<small>${unit}</small></strong>
			<div class="fg-meter"><i style="width:${Math.max(0, Math.min(100, value || 0))}%"></i></div><p>${detail || `Advertencia ${warn}${unit} · Crítico ${crit}${unit}`}</p>
		</button>`;
	}

	_numberCard(label, value, item, detail) {
		const itemid = item?.itemid || '';
		return `<button class="fg-kpi neutral" ${itemid ? `data-chart-items="${itemid}" data-chart-title="${this._e(label)}"` : ''}><div class="fg-kpi-head"><span>${label}</span><b class="fg-dot ok"></b></div><strong>${value === null ? '—' : this._compact(value)}</strong><p>${detail}</p></button>`;
	}

	_wanCard(row, settings) {
		const speed = this._num(row.speed);
		const input = this._num(row.in);
		const output = this._num(row.out);
		const peak = Math.max(input || 0, output || 0);
		const util = speed ? peak / speed * 100 : null;
		const level = this._levelHigh(util, settings.bandwidth_warn, settings.bandwidth_crit);
		const ids = [row.in?.itemid, row.out?.itemid].filter(Boolean);
		const state = this._interfaceStatus(row.status, row);
		return `<div class="fg-wan ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="WAN ${this._e(row.name)}" data-chart-units="bps"` : ''}>
			<div class="fg-wan-head"><div><strong>${this._e(row.name)}</strong><small>${this._e(row.alias || 'Interfaz WAN')}</small></div><span class="fg-state ${state.class}" title="${this._e(state.detail)}">${this._e(state.label)}</span></div>
			<div class="fg-traffic-values"><span>↓ ${this._bits(input)}</span><span>↑ ${this._bits(output)}</span><b>${util === null ? '—' : this._fmt(util)+'%'}</b></div>
			<canvas class="fg-chart" data-series="${ids.join(',')}"></canvas><p>Capacidad ${this._bits(speed)} · Warn ${settings.bandwidth_warn}% · Crit ${settings.bandwidth_crit}%</p>
		</div>`;
	}

	_interfacesView(data, settings) {
		const rows = [...data.interfaces].sort((a, b) => Number(b.is_wan) - Number(a.is_wan) || a.name.localeCompare(b.name));
		return `<article class="fg-panel fg-wide"><div class="fg-panel-title"><div><h3>Interfaces de red</h3><p>WAN destacadas, tráfico, velocidad y errores</p></div><div class="fg-panel-actions"><span class="fg-chip">${rows.length} visibles</span><button class="fg-config-button" data-interface-editor-toggle>⚙ Filtrar</button></div></div>
			${this._interfaceEditor(data)}
			<div class="fg-table-wrap"><table class="fg-table"><thead><tr><th>Interfaz</th><th>Tipo</th><th>Estado</th><th>Velocidad</th><th>Entrada</th><th>Salida</th><th>Utilización</th><th>Errores</th></tr></thead><tbody>
			${rows.map(row => {
				const speed = this._num(row.speed), input = this._num(row.in), output = this._num(row.out);
				const util = speed ? Math.max(input || 0, output || 0) / speed * 100 : null;
				const level = this._levelHigh(util, settings.bandwidth_warn, settings.bandwidth_crit);
				const ids = [row.in?.itemid, row.out?.itemid].filter(Boolean);
				const state = this._interfaceStatus(row.status, row);
					return `<tr ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="Interfaz ${this._e(row.name)}" data-chart-units="bps"` : ''}><td><strong>${this._e(row.name)}</strong><small>${this._e(row.alias)}</small></td><td>${row.is_wan ? '<span class="fg-chip wan">WAN</span>' : row.is_sdwan ? '<span class="fg-chip sdwan">SD-WAN</span>' : row.is_physical ? 'Física' : 'Lógica / Otra'}</td><td><span class="fg-state ${state.class}" title="${this._e(state.detail)}">${this._e(state.label)}</span></td><td>${this._bits(speed)}</td><td class="in">↓ ${this._bits(input)}</td><td class="out">↑ ${this._bits(output)}</td><td><span class="fg-util ${level}"><i style="width:${Math.min(100, util || 0)}%"></i></span>${util === null ? '—' : this._fmt(util)+'%'}</td><td>${this._compact((this._num(row.in_errors)||0)+(this._num(row.out_errors)||0))}</td></tr>`;
			}).join('')}</tbody></table></div></article>`;
	}

	_sdwanView(data, settings) {
		return `<div class="fg-sdwan-grid">${data.sdwan.map(row => {
			const latency = this._num(row.latency), jitter = this._num(row.jitter), loss = this._num(row.loss);
			const level = this._worst([
				this._levelHigh(latency, settings.latency_warn, settings.latency_crit),
				this._levelHigh(jitter, settings.jitter_warn, settings.jitter_crit),
				this._levelHigh(loss, settings.loss_warn, settings.loss_crit),
				['dead', 'error'].includes(this._sdwanState(row.state)) ? 'crit' : 'ok'
			]);
			const ids = [row.latency?.itemid, row.jitter?.itemid, row.loss?.itemid].filter(Boolean);
			return `<article class="fg-panel fg-sdwan ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="SLA ${this._e(row.health)} · ${this._e(row.interface)}"` : ''}>
				<div class="fg-panel-title"><div><h3>${this._e(row.health)}</h3><p>${this._e(row.interface)}</p></div><span class="fg-state ${this._sdwanState(row.state)}">${this._sdwanState(row.state)}</span></div>
				<div class="fg-sla-values"><div><span>Latencia</span><strong>${latency === null ? '—' : this._fmt(latency)} ms</strong><small>${settings.latency_warn}/${settings.latency_crit} ms</small></div><div><span>Jitter</span><strong>${jitter === null ? '—' : this._fmt(jitter)} ms</strong><small>${settings.jitter_warn}/${settings.jitter_crit} ms</small></div><div><span>Pérdida</span><strong>${loss === null ? '—' : this._fmt(loss)}%</strong><small>${settings.loss_warn}/${settings.loss_crit}%</small></div></div>
				<canvas class="fg-chart tall" data-series="${ids.join(',')}"></canvas><p class="fg-note">Promedios calculados por el health-check de FortiGate sobre sus últimas sondas.</p>
			</article>`;
		}).join('')}</div>`;
	}

	_vpnView(data) {
		return `<div class="fg-kpis compact">${this._numberCard('Túneles IPsec activos', this._num(data.vpn_active), data.vpn_active, 'Con al menos una SA')}${this._numberCard('Usuarios SSL-VPN', this._num(data.vpn_users), data.vpn_users, 'Sesiones actuales')}</div>
		<article class="fg-panel fg-wide"><div class="fg-panel-title"><div><h3>Túneles VPN descubiertos</h3><p>Estado individual informado por la MIB de Fortinet</p></div></div>${data.vpns.length ? `<div class="fg-table-wrap"><table class="fg-table"><thead><tr><th>Túnel</th><th>Estado</th><th>Último dato</th></tr></thead><tbody>${data.vpns.map(row => `<tr><td><strong>${this._e(row.name)}</strong></td><td><span class="fg-state ${this._vpnState(row.status)}">${this._vpnState(row.status)}</span></td><td>${this._itemAge(row.status)}</td></tr>`).join('')}</tbody></table></div>` : this._empty('Sin túneles descubiertos', 'El contador general puede existir aunque el descubrimiento no exponga el nombre de cada túnel.')}</article>`;
	}

	_securityView(data) {
		return `<article class="fg-panel fg-wide"><div class="fg-panel-title"><div><h3>Actividad IPS</h3><p>Contadores agregados por segundo; no sustituye el detalle de FortiAnalyzer</p></div></div><div class="fg-security-grid">${data.security.map(item => `<div><span>${this._e(this._securityLabel(item.key_))}</span><strong>${this._num(item) === null ? this._e(item.lastvalue || '—') : this._compact(this._num(item))}</strong><small>${this._itemAge(item)}</small></div>`).join('')}</div></article>`;
	}

	_haView(data) {
		return `<div class="fg-ha-summary"><span>Modo <strong>${this._e(this._haMode(data.ha_mode))}</strong></span><span>Grupo <strong>${this._e(data.ha_group_name?.lastvalue || data.ha_group_id?.lastvalue || '—')}</strong></span><span>Auto-sync <strong>${this._yesNo(data.ha_auto_sync)}</strong></span></div><div class="fg-ha-grid">${data.ha.map(row => `<article class="fg-panel"><div class="fg-panel-title"><div><h3>${this._e(row.hostname?.lastvalue || `Miembro ${row.id}`)}</h3><p>${this._e(row.serial?.lastvalue || 'Serial sin datos')}</p></div><span class="fg-state ${this._syncState(row.sync)}">${this._syncState(row.sync)}</span></div><div class="fg-sla-values"><div><span>CPU</span><strong>${this._value(row.cpu, '%')}</strong></div><div><span>RAM</span><strong>${this._value(row.memory, '%')}</strong></div><div><span>Sesiones</span><strong>${this._compact(this._num(row.sessions))}</strong></div></div><div class="fg-facts">${this._fact('Ancho de banda', this._bits(this._num(row.network)), 'neutral')}${this._fact('Paquetes/s', this._compact(this._num(row.packets)), 'neutral')}${this._fact('Eventos IPS/s', this._compact(this._num(row.ips)), 'neutral')}</div></article>`).join('')}</div>`;
	}

	_sensorsView(data, settings) {
		return `<article class="fg-panel fg-wide"><div class="fg-panel-title"><div><h3>Sensores físicos</h3><p>El estado de alarma nativo tiene prioridad; los límites °C se aplican a valores identificados como temperatura</p></div><span class="fg-chip">${data.sensors.length}</span></div><div class="fg-sensor-grid">${data.sensors.map(row => {
			const numeric = this._sensorNumber(row.value?.lastvalue);
			const isTemp = /(temp|thermal|hotspot)/i.test(row.name);
			const alarm = this._num(row.status) === 1;
			const level = alarm ? 'crit' : (isTemp ? this._levelHigh(numeric, settings.temperature_warn, settings.temperature_crit) : 'ok');
			return `<div class="fg-sensor ${level}"><span class="fg-sensor-icon">${isTemp ? '♨' : /(fan)/i.test(row.name) ? '✣' : /(psu|power|voltage)/i.test(row.name) ? 'ϟ' : '●'}</span><div><strong>${this._e(row.name)}</strong><span>${this._e(row.value?.lastvalue || 'Sin datos')}</span><small>${alarm ? 'Alarma reportada por el equipo' : isTemp ? `Warn ${settings.temperature_warn}°C · Crit ${settings.temperature_crit}°C` : 'Estado normal'}</small></div></div>`;
		}).join('')}</div></article>`;
	}

	_vdomView(data) {
		return `<article class="fg-panel fg-wide"><div class="fg-panel-title"><div><h3>Dominios virtuales</h3><p>Recursos y sesiones por VDOM</p></div></div><div class="fg-table-wrap"><table class="fg-table"><thead><tr><th>VDOM</th><th>Modo</th><th>HA</th><th>CPU</th><th>RAM</th><th>Sesiones</th><th>Sesiones/s</th></tr></thead><tbody>${data.vdom.map(row => `<tr><td><strong>${this._e(row.name)}</strong></td><td>${this._vdomMode(row.mode)}</td><td>${this._e(row.ha?.lastvalue || '—')}</td><td>${this._value(row.cpu, '%')}</td><td>${this._value(row.memory, '%')}</td><td>${this._compact(this._num(row.sessions))}</td><td>${this._compact(this._num(row.rate))}</td></tr>`).join('')}</tbody></table></div></article>`;
	}

	_prepare(host) {
		const d = {hostid: host.hostid, interfaces: [], all_interfaces: [], hidden_interfaces: 0, grouped_interfaces: 0, sdwan: [], vpns: [], ha: [], sensors: [], vdom: [], security: []};
		const exact = {};
		const groups = {interfaces: {}, sdwan: {}, vpns: {}, ha: {}, sensors: {}, vdom: {}};
			const wanRegex = this._regex(this._payload.settings.wan_regex);
			const manualWan = this._hostWanSet(host.hostid);
			const expectedDownRegex = this._regex(this._payload.settings.expected_down_regex || '(?!)');

		(host.items || []).forEach(item => {
			exact[item.key_] = item;
			const key = item.key_;
			let match;
			if ((key.startsWith('net.if.') || key.startsWith('fgate.netif.')) && (match = key.match(/\[([^\]]+)\]$/))) {
				const id = match[1], row = groups.interfaces[id] ||= {id, name: `Interfaz ${id}`, alias: ''};
				const identity = this._interfaceIdentity(item.name);
				if (identity.name) { row.name = identity.name; row.alias = identity.alias; }
					if (key.startsWith('net.if.status[') || key.startsWith('fgate.netif.status[')) row.status = item;
					else if (key.startsWith('net.if.adminstatus[') || key.startsWith('fgate.netif.admin_status[')) row.admin_status = item;
				else if (key.startsWith('net.if.speed[') || key.startsWith('fgate.netif.speed[')) row.speed = item;
				else if (key.startsWith('net.if.in.errors[') || key.startsWith('fgate.netif.in_errors[')) row.in_errors = item;
				else if (key.startsWith('net.if.out.errors[') || key.startsWith('fgate.netif.out_errors[')) row.out_errors = item;
				else if (key.startsWith('net.if.in.discards[')) row.in_discards = item;
					else if (key.startsWith('net.if.out.discards[')) row.out_discards = item;
					else if (key.startsWith('net.if.type[') || key.startsWith('fgate.netif.type[')) row.type = item;
				else if (key.startsWith('net.if.in[') || key.startsWith('fgate.netif.in[')) row.in = item;
				else if (key.startsWith('net.if.out[') || key.startsWith('fgate.netif.out[')) row.out = item;
			}
			else if ((key.startsWith('sdwan_health.') || key.startsWith('fgate.sdwan_health.')) && (match = key.match(/\[([^\]]+)\]$/))) {
				const id = match[1], identity = this._sdwanIdentity(item.name), row = groups.sdwan[id] ||= {id, health: identity.health || `Health-check ${id}`, interface: identity.interface || `Miembro ${id}`};
				if (key.includes('.state[') || key.includes('.status[')) row.state = item;
				else if (key.includes('.latency[')) row.latency = item;
				else if (key.includes('.jitter[')) row.jitter = item;
				else if (key.includes('.loss[')) row.loss = item;
				else if (key.includes('.sent[')) row.sent = item;
				else if (key.includes('.received[')) row.received = item;
			}
			else if (key.startsWith('vpn.tunnel.status[')) {
				const name = (item.name.match(/^VPN\s+(.+?):/) || [null, item.name])[1]; groups.vpns[item.itemid] = {name, status: item};
			}
			else if (key.startsWith('ha.') && (match = key.match(/\.(\d+)\]$/))) {
				const id = match[1], row = groups.ha[id] ||= {id};
				if (key.startsWith('ha.serialnumber[')) row.serial = item;
				else if (key.startsWith('ha.hostname[')) row.hostname = item;
				else if (key.startsWith('ha.cpu.usage[')) row.cpu = item;
				else if (key.startsWith('ha.mem.usage[')) row.memory = item;
				else if (key.startsWith('ha.net.usage[')) row.network = item;
				else if (key.startsWith('ha.session.count[')) row.sessions = item;
				else if (key.startsWith('ha.packets.rate[')) row.packets = item;
				else if (key.startsWith('ha.ips.events[')) row.ips = item;
				else if (key.startsWith('ha.sync.status[')) row.sync = item;
			}
			else if (key.startsWith('hw.sensor.') && (match = key.match(/\.(\d+)\]$/))) {
				const id = match[1], name = (item.name.match(/^Sensor\s+(.+?):/) || [null, `Sensor ${id}`])[1], row = groups.sensors[id] ||= {id, name};
				if (key.startsWith('hw.sensor.value[')) row.value = item; else if (key.startsWith('hw.sensor.status[')) row.status = item;
			}
			else if (key.startsWith('vdom.') && (match = key.match(/\.(\d+)\]$/))) {
				const id = match[1], name = (item.name.match(/^VDOM\s+(.+?):/) || [null, `VDOM ${id}`])[1], row = groups.vdom[id] ||= {id, name};
				if (key.startsWith('vdom.op_mode[')) row.mode = item;
				else if (key.startsWith('vdom.ha.state[')) row.ha = item;
				else if (key.startsWith('vdom.cpu.usage[')) row.cpu = item;
				else if (key.startsWith('vdom.mem.usage[')) row.memory = item;
				else if (key.startsWith('vdom.sessions.rate[')) row.rate = item;
				else if (key.startsWith('vdom.sessions[')) row.sessions = item;
			}
			if (key.startsWith('ips.') && !key.includes('.walk')) d.security.push(item);
		});

		const items = host.items || [];
		const pick = (keys, names = null) => keys.map(key => exact[key]).find(Boolean) || (names ? items.find(item => names.test(item.name)) : null);
		Object.assign(d, {
			source: items.some(item => item.key_.startsWith('fgate.')) ? 'HTTP API' : 'SNMP',
			model: pick(['system.hw.model', 'fgate.device.model'], /device model|hardware model/i)?.lastvalue,
			firmware: pick(['system.hw.firmware', 'fgate.device.firmware'], /firmware version/i)?.lastvalue,
			serial: pick(['system.hw.serialnumber', 'fgate.device.serialnumber'], /serial number/i)?.lastvalue,
			uptime: pick(['system.uptime[fgSysUpTime.0]', 'fgate.uptime'], /system uptime/i),
			cpu: pick(['system.cpu.util[fgSysCpuUsage.0]', 'fgate.cpu.util'], /^CPU utilization$/i),
			memory_total: pick(['vm.memory.total[fgSysMemCapacity.0]', 'fgate.memory.total'], /^Total memory$/i),
			memory_util: pick(['vm.memory.util[memoryUsedPercentage.0]', 'fgate.memory.util'], /^Memory utilization$/i),
			memory_used: pick(['vm.memory.used[fgSysMemUsage.0]'], /^Used memory$/i),
			disk_free_pct: pick(['vfs.fs.pfree'], /^Free disk percentage$/i),
			disk_util: pick(['fgate.fs.util'], /^Disk utilization$/i),
			disk_free: pick(['vfs.fs.free', 'fgate.fs.free'], /^Free disk space$/i),
			sessions: pick(['net.ipv4.sessions[fgSysSesCount.0]'], /IPv4 Active sessions/i),
			ping: pick(['icmpping'], /^ICMP ping$/i),
			collector: pick(['zabbix[host,snmp,available]', 'fgate.api.status'], /SNMP agent availability|API availability status/i),
			vpn_active: exact['vpn.tunnel.active[fgVpnTunnelUpCount.0]'], vpn_users: exact['vpn.users.count[fgVpnSslStatsLoginUsers.0]'],
			ha_mode: exact['ha.mode[fgHaSystemMode.0]'], ha_group_name: exact['ha.cluster.group_name[fgHaGroupName.0]'], ha_group_id: exact['ha.cluster.group_id[fgHaGroupId.0]'], ha_auto_sync: exact['ha.auto.sync[fgHaAutoSync.0]']
		});
			const sdwanNames = new Set(Object.values(groups.sdwan).map(row => String(row.interface || '').trim().toLowerCase()).filter(Boolean));
			d.all_interfaces = Object.values(groups.interfaces).map(row => {
				const identity = `${row.name} ${row.alias}`.trim();
				const typeValue = String(row.type?.lastvalue || '').toLowerCase();
				const isManualWan = manualWan.has(String(row.name).trim().toLowerCase());
				return {...row,
					is_wan: isManualWan || wanRegex.test(identity),
					is_wan_manual: isManualWan,
					is_sdwan: sdwanNames.has(String(row.name).trim().toLowerCase()),
					is_physical: /physical|ethernet|gigabit|fastether|^0$/.test(typeValue) || (!row.type && /^(port|wan|lan|dmz|x)\d+$/i.test(row.name)),
					expected_down: expectedDownRegex.test(identity)
				};
			});
		const filteredInterfaces = this._filterInterfaces(d.all_interfaces, host.hostid);
		d.hidden_interfaces = d.all_interfaces.length - filteredInterfaces.length;
		const interfacePreferences = this._interfacePreferences(host.hostid);
		d.interfaces = interfacePreferences.deduplicate ? this._deduplicateInterfaces(filteredInterfaces) : filteredInterfaces;
		d.grouped_interfaces = filteredInterfaces.length - d.interfaces.length;
		d.sdwan = Object.values(groups.sdwan); d.vpns = Object.values(groups.vpns); d.ha = Object.values(groups.ha); d.sensors = Object.values(groups.sensors); d.vdom = Object.values(groups.vdom);
		return d;
	}

	_exact(host, key) { return (host.items || []).find(item => item.key_ === key); }
	_pick(host, keys, names = null) { const items=host.items||[]; return keys.map(key=>items.find(item=>item.key_===key)).find(Boolean)||(names?items.find(item=>names.test(item.name)):null); }
	_regex(value) { try { return new RegExp(value, 'i'); } catch (_) { return /(wan|internet|isp|outside|uplink|broadband|sdwan)/i; } }
	_nameSet(value) { return new Set(String(value || '').split(/[,;\n]+/).map(name => name.trim().toLowerCase()).filter(Boolean)); }
	_storageScope() {
		const node=this._body?.closest?.('.dashboard-grid-widget,[data-widgetid],[data-widget-id],[data-uniqueid]');
		return String(this._widgetid||node?.dataset?.widgetid||node?.dataset?.widgetId||node?.dataset?.uniqueid||node?.id||this._body?.id||'default');
	}
	_hostWanKey(hostid) { return `laka.fortigate.wan.v1:${location.pathname}:${this._storageScope()}:${hostid}`; }
	_hostWanSet(hostid) {
		try { const value=JSON.parse(localStorage.getItem(this._hostWanKey(hostid))||'[]'); return this._nameSet(Array.isArray(value)?value.join(','):''); }
		catch (_) { return new Set(); }
	}
	_saveHostWanSet(hostid,value) {
		const names=[...this._nameSet(value)];
		try { localStorage.setItem(this._hostWanKey(hostid),JSON.stringify(names)); }
		catch (_) { return false; }
		return true;
	}
	_clearHostWanSet(hostid) { try { localStorage.removeItem(this._hostWanKey(hostid)); return true; } catch (_) { return false; } }
	_bindWanEditor(container,host,data) {
		const editor=container.querySelector('.fg-wan-editor'),toggle=container.querySelector('[data-wan-editor-toggle]');
		if(!editor||!toggle)return;
		const input=editor.querySelector('[data-wan-editor-input]');
		toggle.addEventListener('click',()=>{editor.hidden=!editor.hidden;if(!editor.hidden){input.focus();input.select();}});
		editor.querySelector('[data-wan-editor-cancel]').addEventListener('click',()=>{editor.hidden=true;});
		editor.querySelector('[data-wan-editor-save]').addEventListener('click',()=>{if(this._saveHostWanSet(host.hostid,input.value))this._renderHost(container);});
		editor.querySelector('[data-wan-editor-clear]').addEventListener('click',()=>{if(this._clearHostWanSet(host.hostid))this._renderHost(container);});
		input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();editor.querySelector('[data-wan-editor-save]').click();}if(event.key==='Escape')editor.hidden=true;});
	}
	_interfacePreferenceKey(hostid) { return `laka.fortigate.interfaces.v1:${location.pathname}:${this._storageScope()}:${hostid}`; }
	_interfacePreferenceDefaults() { return {hide_vlan:true,hide_logical:false,hide_down_idle:false,deduplicate:true,exclude_regex:''}; }
	_interfacePreferences(hostid) {
		const defaults=this._interfacePreferenceDefaults();
		try { const saved=JSON.parse(localStorage.getItem(this._interfacePreferenceKey(hostid))||'{}'); return {...defaults,...(saved&&typeof saved==='object'?saved:{})}; }
		catch (_) { return defaults; }
	}
	_saveInterfacePreferences(hostid,preferences) {
		try { localStorage.setItem(this._interfacePreferenceKey(hostid),JSON.stringify({...this._interfacePreferenceDefaults(),...preferences})); return true; }
		catch (_) { return false; }
	}
	_filterInterfaces(rows,hostid) {
		const preferences=this._interfacePreferences(hostid);
		let exclude=null;
		if(preferences.exclude_regex){try{exclude=new RegExp(preferences.exclude_regex,'i');}catch(_){exclude=null;}}
		return rows.filter(row=>{
			const identity=`${row.name||''} ${row.alias||''}`.trim();
			if(exclude?.test(identity))return false;
			if(preferences.hide_vlan&&!row.is_wan_manual&&/\bvlan\s*\d*/i.test(identity))return false;
			if(preferences.hide_logical&&!row.is_physical&&!row.is_wan&&!row.is_sdwan)return false;
			if(preferences.hide_down_idle&&!row.is_wan&&!row.is_sdwan){
				const state=this._interfaceStatus(row.status,row).class.split(' ')[0];
				const traffic=Math.max(this._num(row.in)||0,this._num(row.out)||0);
				if(state!=='up'&&traffic<=0)return false;
			}
			return true;
		});
	}
	_interfaceScore(row) {
		const state=this._interfaceStatus(row.status,row).class.split(' ')[0];
		const traffic=Math.max(this._num(row.in)||0,this._num(row.out)||0);
		const lastclock=Math.max(Number(row.status?.lastclock||0),Number(row.in?.lastclock||0),Number(row.out?.lastclock||0));
		return (state==='up'?1e15:0)+(traffic>0?1e14:0)+(row.is_wan?1e13:0)+(row.is_sdwan?1e12:0)+Math.min(traffic,1e11)+lastclock;
	}
	_deduplicateInterfaces(rows) {
		const groups=new Map();
		rows.forEach(row=>{const key=String(row.name||row.id).trim().toLowerCase();const group=groups.get(key)||[];group.push(row);groups.set(key,group);});
		return [...groups.values()].map(group=>{
			const selected=[...group].sort((a,b)=>this._interfaceScore(b)-this._interfaceScore(a))[0];
			return {...selected,duplicate_count:group.length};
		});
	}
	_interfaceEditor(data) {
		const preferences=this._interfacePreferences(data.hostid);
		const checked=value=>value?' checked':'';
		return `<div class="fg-interface-editor" hidden>
			<div class="fg-interface-options">
				<label><input type="checkbox" data-interface-option="hide_vlan"${checked(preferences.hide_vlan)}> Ocultar VLAN</label>
				<label><input type="checkbox" data-interface-option="hide_logical"${checked(preferences.hide_logical)}> Ocultar lógicas y túneles</label>
				<label><input type="checkbox" data-interface-option="hide_down_idle"${checked(preferences.hide_down_idle)}> Ocultar DOWN sin tráfico</label>
				<label><input type="checkbox" data-interface-option="deduplicate"${checked(preferences.deduplicate)}> Agrupar nombres repetidos</label>
			</div>
			<label class="fg-interface-regex">Excluir por nombre o alias (expresión regular)<input type="text" data-interface-exclude value="${this._e(preferences.exclude_regex)}" placeholder="^(Vlan|ssl\\.|loopback|tunnel)"></label>
			<small>${data.all_interfaces.length} detectadas · ${data.interfaces.length} visibles${data.hidden_interfaces?` · ${data.hidden_interfaces} ocultas`:''}${data.grouped_interfaces?` · ${data.grouped_interfaces} repetidas agrupadas`:''}. La configuración pertenece sólo a este FortiGate y navegador.</small>
			<p class="fg-interface-error" hidden></p>
			<div class="fg-interface-editor-actions"><button data-interface-save>Guardar</button><button data-interface-reset>Restablecer</button><button data-interface-cancel>Cancelar</button></div>
		</div>`;
	}
	_bindInterfaceEditor(container,host) {
		const editor=container.querySelector('.fg-interface-editor'),toggle=container.querySelector('[data-interface-editor-toggle]');
		if(!editor||!toggle)return;
		const regex=editor.querySelector('[data-interface-exclude]'),error=editor.querySelector('.fg-interface-error');
		toggle.addEventListener('click',()=>{editor.hidden=!editor.hidden;if(!editor.hidden)regex.focus();});
		editor.querySelector('[data-interface-cancel]').addEventListener('click',()=>{editor.hidden=true;});
		editor.querySelector('[data-interface-save]').addEventListener('click',()=>{
			const value=regex.value.trim();
			if(value){try{new RegExp(value,'i');}catch(exception){error.textContent=`Expresión no válida: ${exception.message}`;error.hidden=false;return;}}
			const preferences={exclude_regex:value};
			editor.querySelectorAll('[data-interface-option]').forEach(input=>preferences[input.dataset.interfaceOption]=input.checked);
			if(this._saveInterfacePreferences(host.hostid,preferences))this._renderHost(container);
		});
		editor.querySelector('[data-interface-reset]').addEventListener('click',()=>{
			try{localStorage.removeItem(this._interfacePreferenceKey(host.hostid));this._renderHost(container);}catch(_){error.textContent='No fue posible restablecer la configuración local.';error.hidden=false;}
		});
		regex.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();editor.querySelector('[data-interface-save]').click();}if(event.key==='Escape')editor.hidden=true;});
	}
	_interfaceIdentity(name) { const m = name.match(/^Interface\s+\[?(.+?)\((.*?)\)\]?:/); if(m)return {name:m[1],alias:m[2]}; const simple=name.match(/^Interface\s+\[?([^:\]]+)\]?:/); return simple?{name:simple[1],alias:''}:{name:'',alias:''}; }
	_sdwanIdentity(name) { const m = name.match(/^SD-WAN\s+\[([^\]]+)\]:\[([^\]]+)\]:/); return m ? {health: m[1], interface: m[2]} : {}; }
	_num(item) { if (!item || item.lastvalue === '' || item.lastvalue === null || Number.isNaN(Number(item.lastvalue))) return null; return Number(item.lastvalue); }
	_value(item, unit = '') { const value = this._num(item); return value === null ? '—' : `${this._fmt(value)}${unit}`; }
	_fmt(value) { return new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(value); }
	_compact(value) { return value === null || value === undefined ? '—' : new Intl.NumberFormat(undefined, {notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1}).format(value); }
	_bytes(value) { if (value === null || value === undefined) return '—'; const u=['B','KB','MB','GB','TB']; let i=0; while(Math.abs(value)>=1024&&i<u.length-1){value/=1024;i++;} return `${this._fmt(value)} ${u[i]}`; }
	_bits(value) { if (value === null || value === undefined) return '—'; const u=['bps','Kbps','Mbps','Gbps','Tbps']; let i=0; while(Math.abs(value)>=1000&&i<u.length-1){value/=1000;i++;} return `${this._fmt(value)} ${u[i]}`; }
	_levelHigh(value, warn, crit) { return value === null ? 'nodata' : value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok'; }
	_worst(levels) { return levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : levels.includes('nodata') ? 'nodata' : 'ok'; }
		_interfaceStatus(item,row=null) {
			const v=this._num(item),isHttp=item?.key_?.startsWith('fgate.netif.');
			const admin=this._num(row?.admin_status);
			if(isHttp){if(v===1)return {class:'up',label:'UP',detail:'HTTP API · estado 1 (enlace activo)'};if(v===0&&row?.expected_down)return {class:'expected',label:'DOWN esperado',detail:'Enlace inactivo excluido mediante la expresión de interfaces esperadas DOWN'};if(v===0)return {class:'down',label:'DOWN',detail:'HTTP API · estado 0 (enlace inactivo)'};}
			else {
				const states={1:{class:'up',label:'UP',text:'enlace activo'},2:{class:'down',label:'DOWN',text:'enlace inactivo'},3:{class:'testing',label:'TESTING',text:'en pruebas'},4:{class:'unknown',label:'UNKNOWN',text:'estado desconocido'},5:{class:'dormant',label:'DORMANT',text:'esperando un evento externo'},6:{class:'not-present',label:'NOT PRESENT',text:'componente no presente'},7:{class:'lower-down',label:'LOWER DOWN',text:'capa inferior inactiva'}};
				if(states[v]){const state=states[v];if(v!==1&&row?.expected_down)return {class:'expected',label:'DOWN esperado',detail:`SNMP ifOperStatus ${v} · excluida mediante configuración`};return {class:state.class,label:state.label,detail:`SNMP ifOperStatus ${v} · ${state.text}${admin===2?' · administrativamente DOWN':''}`};}
		}
		const traffic=Math.max(this._num(row?.in)||0,this._num(row?.out)||0);
		if(!item&&traffic>0)return {class:'up inferred',label:'UP*',detail:'Estado inferido por tráfico reciente; no existe ítem de estado'};
		return {class:'unknown',label:'UNKNOWN',detail:item?`Valor de estado no reconocido: ${item.lastvalue}`:'Sin ítem de estado disponible'};
	}
	_naturalCompare(a,b){return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});}
	_problemRow(problem,data) {
		const status=this._problemState(problem,data),state=status.state,recovered=status.recovered,currentDown=status.currentDown;
		const rowClass=recovered?'is-recovered':currentDown?'is-current-down':'';
		const note=recovered?`<em class="fg-recovered">Recuperada · pendiente de cierre</em><time>${this._age(problem.clock)}</time>`:currentDown?`<em class="fg-current-down">${this._e(state.label)} actual</em><time>${this._age(problem.clock)}</time>`:`<time>${this._age(problem.clock)}</time>`;
		return `<div class="${rowClass}" title="${this._e(state?.detail||'Problema activo en Zabbix')}"><span class="${recovered?'state-recovered':`sev-${problem.severity}`}"></span><strong>${this._e(problem.name)}</strong><small>${note}</small></div>`;
	}
	_problemState(problem,data){
		const match=problem.name.match(/Interface\s+\[?([^\]()\]:]+)\s*\(/i),name=match?.[1]?.trim();
		const matches=name?(data.all_interfaces||data.interfaces||[]).filter(item=>item.name.trim().toLowerCase()===name.toLowerCase()):[];
		const row=matches.sort((a,b)=>this._interfaceScore(b)-this._interfaceScore(a))[0]||null;
		const state=row?this._interfaceStatus(row.status,row):null,isLinkDown=/interface.+link down/i.test(problem.name);
		return {state,recovered:isLinkDown&&state?.class.split(' ').includes('up'),currentDown:isLinkDown&&state&&['down','not-present','lower-down'].includes(state.class)};
	}
	_problemBuckets(host,data){
		const active=[],recovered=[];
		(host.problems||[]).forEach(problem=>(this._problemState(problem,data).recovered?recovered:active).push(problem));
		return {active,recovered};
	}
	_sdwanState(item) { const v=this._num(item); return v===0?'alive':v===1?'dead':v===2?'error':'unknown'; }
	_vpnState(item) { const v=this._num(item); return v===2?'up':v===1?'down':'unknown'; }
	_syncState(item) { const v=this._num(item); return v===1?'sincronizado':v===0?'sin sincronizar':'desconocido'; }
	_haMode(item) { const v=this._num(item); return v===1?'Standalone':v===2?'Activo-Activo':v===3?'Activo-Pasivo':item?.lastvalue||'Sin datos'; }
	_vdomMode(item) { const v=this._num(item); return v===1?'NAT':v===2?'Transparente':item?.lastvalue||'—'; }
	_yesNo(item) { const v=this._num(item); return v===1?'Habilitado':v===0?'Deshabilitado':'—'; }
	_uptime(seconds) { if (seconds===null) return '—'; const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor((seconds%3600)/60); return `${d}d ${h}h ${m}m`; }
	_itemAge(item) { return item?.lastclock ? this._age(item.lastclock) : 'Sin datos'; }
	_age(clock) { const s=Math.max(0,Math.floor(Date.now()/1000-clock)); if(s<60)return `hace ${s}s`; if(s<3600)return `hace ${Math.floor(s/60)}m`; if(s<86400)return `hace ${Math.floor(s/3600)}h`; return `hace ${Math.floor(s/86400)}d`; }
	_sensorNumber(value) { const m=String(value??'').match(/-?\d+(?:[.,]\d+)?/); return m?Number(m[0].replace(',','.')):null; }
	_securityLabel(key) { const labels={'ips.blocked[fgIpsIntrusionsBlocked.0]':'Intrusiones bloqueadas','ips.detected.total[fgIpsIntrusionsDetected.0]':'Detecciones totales','ips.detected.crit[fgIpsCritSevDetections.0]':'Críticas','ips.detected.high[fgIpsHighSevDetections.0]':'Altas','ips.detected.med[fgIpsMedSevDetections.0]':'Medias','ips.detected.low[fgIpsLowSevDetections.0]':'Bajas','ips.detected.info[fgIpsInfoSevDetections.0]':'Informativas','ips.detected.anomaly[fgIpsAnomalyDetections.0]':'Anomalías','ips.detected.sign[fgIpsSignatureDetections.0]':'Firmas'}; return labels[key]||key; }
	_hostHealth(host,problems=null) { if(host.maintenance)return {level:'maintenance',label:'Mantenimiento'}; if(!host.enabled)return {level:'nodata',label:'Deshabilitado'}; const evaluated=problems||host.problems||[],max=Math.max(-1,...evaluated.map(p=>p.severity)); if(max>=4)return {level:'crit',label:'Crítico'}; if(max>=2)return {level:'warn',label:'Advertencia'}; const ping=this._exact(host,'icmpping'); if(ping&&this._num(ping)===0)return {level:'crit',label:'No disponible'}; const collector=this._pick(host,['zabbix[host,snmp,available]','fgate.api.status'],/SNMP agent availability|API availability status/i); if(collector&&this._num(collector)!==1)return {level:'nodata',label:'Sin datos de monitoreo'}; return {level:'ok',label:'Normal'}; }
	_fact(label,value,level){return `<div><span>${label}</span><strong class="${level}">${this._e(value)}</strong></div>`;}
	_empty(title,text){return `<div class="fg-empty small"><strong>${this._e(title)}</strong><span>${this._e(text)}</span></div>`;}
	_e(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

	_drawAllCharts() {
		this._body.querySelectorAll('canvas.fg-chart').forEach(canvas => this._drawChart(canvas, canvas.dataset.series.split(',').filter(Boolean), 1, {compact: true}));
	}

	_drawChart(canvas, itemids, hours = null, options = {}) {
		const rect=canvas.getBoundingClientRect(); if(!rect.width||!rect.height)return;
		const dpr=window.devicePixelRatio||1; canvas.width=Math.floor(rect.width*dpr); canvas.height=Math.floor(rect.height*dpr);
		const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); const w=rect.width,h=rect.height;
		const maxHours=hours||this._payload.settings.history_hours, from=Date.now()/1000-maxHours*3600;
		const colors=['#18a8e0','#f38b2a','#8467df','#2eaf72'];
		const series=itemids.map((id,index)=>({id,item:this._findItem(id),points:(this._payload.history[id]||[]).filter(p=>p[0]>=from),color:colors[index%colors.length]})).filter(s=>s.points.length);
		const compact=options.compact===true, style=getComputedStyle(this._body), muted=style.getPropertyValue('--fg-muted').trim()||'#64748b', grid=style.getPropertyValue('--fg-grid').trim()||'rgba(128,128,128,.16)';
		const pad=compact?{l:0,r:0,t:3,b:1}:{l:54,r:14,t:14,b:27}, pw=Math.max(1,w-pad.l-pad.r), ph=Math.max(1,h-pad.t-pad.b);
		ctx.clearRect(0,0,w,h);ctx.font=compact?'9px sans-serif':'10px sans-serif';
		if(!series.length){ctx.fillStyle=muted;ctx.fillText('Sin histórico',compact?8:pad.l,compact?h/2:pad.t+ph/2);return;}
		const all=series.flatMap(s=>s.points.map(p=>p[1])),minT=from,maxT=Date.now()/1000;
		let maxV=Math.max(1,...all),minV=Math.min(0,...all),unit=options.unit||this._chartUnit(series[0].item,'');
		if(unit==='%'){
			const isLoss=series.some(s=>/\.loss\[|packets loss/i.test(`${s.item?.key_||''} ${s.item?.name||''}`));
			maxV=isLoss?Math.max(maxV*1.15,Number(this._payload.settings.loss_crit)||20):100;minV=0;
		}
		else{maxV=maxV===minV?maxV+1:maxV+(maxV-minV)*.1;}
		ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.fillStyle=muted;ctx.textBaseline='middle';
		for(let i=0;i<=4;i++){
			const y=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+pw,y);ctx.stroke();
			if(!compact){const value=maxV-(maxV-minV)*i/4;ctx.textAlign='right';ctx.fillText(this._axisValue(value,unit),pad.l-7,y);}
		}
		if(!compact){ctx.textAlign='center';ctx.textBaseline='top';for(let i=0;i<=4;i++){const x=pad.l+pw*i/4,time=new Date((minT+(maxT-minT)*i/4)*1000);ctx.fillText(time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),x,pad.t+ph+8);}}
		series.forEach(s=>{
			const points=s.points.map(p=>({x:pad.l+(p[0]-minT)/Math.max(1,maxT-minT)*pw,y:pad.t+ph-(p[1]-minV)/Math.max(1,maxV-minV)*ph}));if(!points.length)return;
			const fill=ctx.createLinearGradient(0,pad.t,0,pad.t+ph);fill.addColorStop(0,`${s.color}30`);fill.addColorStop(1,`${s.color}03`);
			ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(points[points.length-1].x,pad.t+ph);ctx.lineTo(points[0].x,pad.t+ph);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
			ctx.beginPath();ctx.strokeStyle=s.color;ctx.lineWidth=compact?1.8:2.2;ctx.lineJoin='round';ctx.lineCap='round';points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
			if(!compact){const last=points[points.length-1];ctx.beginPath();ctx.fillStyle=s.color;ctx.arc(last.x,last.y,3,0,Math.PI*2);ctx.fill();}
		});
	}

	_openChart(title, itemids, units) {
		this._closeModal();
		const max=Math.max(1,Number(this._payload.settings.history_hours)||1), periods=[1,3,6,12,24,72,168].filter(h=>h<=max);
		if(!periods.includes(max))periods.push(max);
		const initial=periods.includes(1)?1:periods[0];
		const groups=this._chartGroups(itemids,units);
		this._modal=document.createElement('div'); this._modal.className='fg-modal';
		const theme=getComputedStyle(this._body);['--fg-panel','--fg-panel-soft','--fg-text','--fg-muted','--fg-border','--fg-grid','--fg-accent','--fg-blue','--fg-green','--fg-amber','--fg-red'].forEach(name=>this._modal.style.setProperty(name,theme.getPropertyValue(name)));
		this._modal.innerHTML=`<div class="fg-modal-card"><header><div><h3>${this._e(title)}</h3><p>Histórico Zabbix completo · 1 hora como vista inicial</p></div><button class="fg-modal-close" title="Cerrar">×</button></header><div class="fg-periods">${periods.map(h=>`<button data-hours="${h}" class="${h===initial?'is-active':''}">${h<24?h+'h':h/24+'d'}</button>`).join('')}</div><div class="fg-modal-charts">${groups.map((group,index)=>`<section class="fg-modal-section"><div class="fg-chart-heading"><strong>${this._e(this._groupTitle(group.unit))}</strong><span>${this._e(group.unit||'valor')}</span></div><canvas class="fg-modal-chart" data-group="${index}"></canvas><div class="fg-chart-stats" data-stats="${index}"></div></section>`).join('')}</div></div>`;
		document.body.appendChild(this._modal);
		const render=hours=>groups.forEach((group,index)=>{this._drawChart(this._modal.querySelector(`[data-group="${index}"]`),group.itemids,hours,{unit:group.unit});this._modal.querySelector(`[data-stats="${index}"]`).innerHTML=this._chartStats(group.itemids,hours,group.unit);});render(initial);
		this._modal.querySelector('.fg-modal-close').addEventListener('click',()=>this._closeModal()); this._modal.addEventListener('click',e=>{if(e.target===this._modal)this._closeModal();});
		this._modal.querySelectorAll('.fg-periods button').forEach(b=>b.addEventListener('click',()=>{this._modal.querySelectorAll('.fg-periods button').forEach(x=>x.classList.toggle('is-active',x===b));render(Number(b.dataset.hours));}));
		this._modalResizeHandler=()=>{const active=this._modal?.querySelector('.fg-periods button.is-active');if(active)render(Number(active.dataset.hours));};window.addEventListener('resize',this._modalResizeHandler);
	}

	_chartGroups(itemids,fallback=''){const groups=[];itemids.forEach(id=>{const unit=this._chartUnit(this._findItem(id),fallback),group=groups.find(row=>row.unit===unit);group?group.itemids.push(id):groups.push({unit,itemids:[id]});});return groups;}
	_chartUnit(item,fallback=''){const key=item?.key_||'',name=item?.name||'',unit=(item?.units||'').trim();if(/netif\.(in|out)\[|net\.if\.(in|out)\[/.test(key))return 'bps';if(/\.loss\[|packets loss/i.test(`${key} ${name}`))return '%';if(/\.latency\[|\.jitter\[|latency|jitter/i.test(`${key} ${name}`))return 'ms';return unit||fallback||'';}
	_groupTitle(unit){return unit==='bps'?'Tráfico de red':unit==='ms'?'Latencia y jitter':unit==='%'?'Porcentaje':'Medición';}
	_axisValue(value,unit){if(unit==='bps')return this._bits(value);if(unit==='B')return this._bytes(value);if(unit==='%')return `${this._fmt(value)}%`;if(unit==='ms')return `${this._fmt(value)} ms`;return this._compact(value);}
	_shortItemName(name){return String(name||'').replace(/^SD-WAN\s+\[[^\]]+\]:\[[^\]]+\]:\s*/i,'').replace(/^Interface\s+\[[^\]]+\]:\s*/i,'');}
	_chartStats(itemids,hours,unit){const from=Date.now()/1000-hours*3600,colors=['#18a8e0','#f38b2a','#8467df','#2eaf72'];return itemids.map((id,index)=>{const item=this._findItem(id),points=(this._payload.history[id]||[]).filter(p=>p[0]>=from);if(!points.length)return `<div><i style="background:${colors[index%colors.length]}"></i><strong>${this._e(this._shortItemName(item?.name||id))}</strong><span>Sin histórico</span></div>`;const values=points.map(p=>p[1]),last=values[values.length-1],min=Math.min(...points.map(p=>p.length>3?p[2]:p[1])),max=Math.max(...points.map(p=>p.length>3?p[3]:p[1])),avg=values.reduce((a,b)=>a+b,0)/values.length;return `<div><i style="background:${colors[index%colors.length]}"></i><strong>${this._e(this._shortItemName(item?.name||id))}</strong><span>Actual <b>${this._e(this._axisValue(last,unit))}</b></span><span>Mín <b>${this._e(this._axisValue(min,unit))}</b></span><span>Prom <b>${this._e(this._axisValue(avg,unit))}</b></span><span>Máx <b>${this._e(this._axisValue(max,unit))}</b></span></div>`;}).join('');}

	_findItem(itemid){for(const host of this._payload.hosts){const item=host.items.find(x=>x.itemid===itemid);if(item)return item;}return null;}
	_restartHostRotation(){
		this._stopHostRotation();
		const hosts=this._payload?.hosts||[],enabled=Number(this._payload?.settings?.enable_auto_rotation)===1,seconds=Math.max(0,Number(this._payload?.settings?.page_display_period)||0);
		if(!enabled||hosts.length<2||seconds===0)return;
		const period=Math.max(5,Math.min(3600,seconds))*1000;
		this._rotationTimer=window.setInterval(()=>{
			if(this._modal)return;
			const current=hosts.findIndex(host=>host.hostid===this._selected_hostid);
			this._selected_hostid=hosts[(current+1+hosts.length)%hosts.length].hostid;
			this._selected_tab='overview';
			this._renderWidget();
		},period);
	}
	_stopHostRotation(){if(this._rotationTimer!==null){window.clearInterval(this._rotationTimer);this._rotationTimer=null;}}
	_closeModal(){if(this._modalResizeHandler){window.removeEventListener('resize',this._modalResizeHandler);this._modalResizeHandler=null;}if(this._modal){this._modal.remove();this._modal=null;}}
}
