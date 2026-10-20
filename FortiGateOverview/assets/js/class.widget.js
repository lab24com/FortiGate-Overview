/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        assets/js/class.widget.js
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Lógica del widget en el navegador: interpreta los datos de las plantillas oficiales
**                 "FortiGate by HTTP" y "FortiGate by SNMP", dibuja la vista de flota, las pestañas de cada
**                 firewall y las gráficas, y solicita bajo demanda el detalle y el histórico.
**                 Los textos visibles se traducen con _t() usando el diccionario de i18n.js.
*/
class WidgetLakaFortiGateOverview extends CWidget {

	static VERSION = '2.1.1';
	static AUTHOR = 'LAKA Soluciones Tecnológicas';
	static FLEET = '__fleet__';
	static HISTORY_ACTION = 'zabbix.php?action=laka.fortigate.history';
	static HOST_ACTION = 'zabbix.php?action=laka.fortigate.host';
	static DETAIL_TTL = 50000;
	// Idiomas disponibles: el valor guardado en el formulario es el índice de esta lista.
	static LANGUAGES = ['es', 'pt_BR', 'en'];
	static LOCALES = {es: 'es', pt_BR: 'pt-BR', en: 'en'};
	static COLORS = ['#18a8e0', '#f38b2a', '#8467df', '#2eaf72', '#e0455a', '#c9a227'];
	static SEVERITIES = ['No clasificado', 'Información', 'Advertencia', 'Promedio', 'Alta', 'Desastre'];
	static HA_MEMBER_KEYS = ['ha.serialnumber[', 'ha.hostname[', 'ha.cpu.usage[', 'ha.mem.usage[', 'ha.net.usage[',
		'ha.session.count[', 'ha.packets.rate[', 'ha.ips.events[', 'ha.sync.status[', 'ha.av.events[', 'ha.bytes.rate[',
		'ha.checksum.global[', 'ha.primary.serialnumber['];
	// Tipo de interfaz según la plantilla HTTP (mapa de valores "Interface type").
	static IF_KIND_HTTP = {0: 'physical', 1: 'vlan', 2: 'aggregate', 3: 'aggregate', 4: 'tunnel', 5: 'other', 6: 'loopback',
		7: 'switch', 8: 'switch', 9: 'other', 10: 'physical', 11: 'tunnel', 12: 'tunnel', 13: 'physical', 14: 'vlan',
		15: 'vlan', 16: 'tunnel', 17: 'other'};
	// Tipo de interfaz según ifType de SNMP (IANAifType).
	static IF_KIND_SNMP = {6: 'physical', 62: 'physical', 69: 'physical', 117: 'physical', 135: 'vlan', 136: 'vlan',
		161: 'aggregate', 131: 'tunnel', 150: 'tunnel', 24: 'loopback', 209: 'switch', 53: 'other', 1: 'other'};
	// Estados de licencia de FortiGuard (mapa de valores "License status" de la plantilla HTTP).
	static LICENSE_STATUS = {0: 'Activado', 1: 'Licenciado', 2: 'Registrado', 3: 'Licencia de evaluación', 4: 'Licencia gratuita',
		5: 'Válido', 6: 'Activación pendiente', 7: 'Error de inicio de sesión', 8: 'No activado', 9: 'Inicio de sesión en curso',
		10: 'Vencido', 11: 'Vence pronto', 12: 'Gratuita (agotada)', 13: 'Licenciado (agotado)', 14: 'Sin licencia',
		15: 'No soportado', 16: 'No registrado', 17: 'Pendiente', 18: 'No disponible', 19: 'Actualización manual',
		20: 'Actualización push', 21: 'Actualización programada', 22: 'Vencido', 23: 'Vencido', 24: 'Vence pronto',
		25: 'Periodo de gracia', 26: 'No válido', 27: 'Validación en curso', 28: 'Validación vencida', 30: 'Desconocido'};
	// 14 (Sin licencia), 15 (No soportado), 18 y 30 son neutros: servicios que nunca se contrataron.
	static LICENSE_LEVEL = {ok: [0, 1, 2, 4, 5, 19, 20, 21], warn: [3, 6, 8, 9, 11, 16, 17, 24, 25, 27],
		crit: [7, 10, 12, 13, 22, 23, 26, 28]};

	onInitialize() {
		super.onInitialize();
		this._selected_hostid = null;
		this._selected_tab = 'overview';
		this._payload = null;
		this._modal = null;
		this._modalResizeHandler = null;
		this._sidebar_collapsed = false;
		this._rotationTimer = null;
		this._cache = new Map();
		this._itemIndex = new Map();
		this._hist = {};
		this._histPending = new Map();
		this._details = new Map();
		this._detailPending = new Map();
		this._tableState = {};
		this._tableSearch = {};
		this._fleetFilter = 'all';
		this._sidebarSort = 'name';
		this._problemSeverity = 0;
		this._policyFilter = 'all';
	}

	setContents(response) {
		super.setContents(response);
		this._cache.clear();
		this._parsePayload();
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

	/* ------------------------------------------------------------------ idioma */

	// Código del idioma elegido en la configuración del widget (es, pt_BR, en).
	_lang() {
		const index = Number(this._payload?.settings?.language);
		return WidgetLakaFortiGateOverview.LANGUAGES[index] || 'es';
	}

	_locale() {
		return WidgetLakaFortiGateOverview.LOCALES[this._lang()] || 'es';
	}

	// Traduce un texto fuente en español; {0}, {1}… se reemplazan por los argumentos.
	_t(key, ...args) {
		const dictionary = (window.LakaFortiGateI18n || {})[this._lang()] || {};
		const text = dictionary[key] || key;
		return args.length ? text.replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match) : text;
	}

	// Singular o plural según la cantidad.
	_n(count, singular, plural) {
		return this._t(Number(count) === 1 ? singular : plural, count);
	}

	// Derechos de autor al pie del widget; el color sigue al tema del frontend (claro u oscuro).
	_authorship() {
		return `<span class="fg-authorship">© ${this._e(WidgetLakaFortiGateOverview.AUTHOR)}</span>`;
	}


	/* ------------------------------------------------------------------ estructura general */

	_parsePayload() {
		const root = this._body.querySelector('.laka-fortigate-root');
		this._payload = null;
		if (!root) return;
		try {
			this._payload = JSON.parse(decodeURIComponent(escape(atob(root.dataset.payload))));
		}
		catch (error) {
			this._payload = null;
			return;
		}
		const now = Date.now();
		this._itemIndex = new Map();
		(this._payload.hosts || []).forEach(host => {
			host.items = (host.items || []).map(item => Array.isArray(item) ? this._itemFromTuple(item) : item);
			// Reutiliza el detalle completo descargado recientemente para no mostrar datos parciales.
			const cached = this._details.get(host.hostid);
			if (!host.detail && cached && now - cached.t < 300000) {
				host.items = cached.items;
				host.unsupported = cached.unsupported;
				host.detail = true;
				host.detail_stale = now - cached.t > WidgetLakaFortiGateOverview.DETAIL_TTL;
			}
			host.items.forEach(item => this._itemIndex.set(item.itemid, item));
		});
	}

	// Convierte la tupla compacta enviada por el servidor en un objeto de ítem.
	_itemFromTuple(t) {
		return {itemid: String(t[0]), key_: t[1], name: t[2], lastvalue: t[3], lastclock: Number(t[4]) || 0, units: t[5] || '',
			value_type: Number(t[6]), state: Number(t[7]) || 0, error: t[8] || ''};
	}

	// Descarga todos los ítems de un firewall (acción laka.fortigate.host).
	_loadHostDetail(hostid) {
		if (this._detailPending.has(hostid)) return this._detailPending.get(hostid);
		const body = new URLSearchParams();
		body.append('hostid', hostid);
		const request = fetch(WidgetLakaFortiGateOverview.HOST_ACTION, {method: 'POST', body, credentials: 'same-origin'})
			.then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
			.then(json => {
				if (!json || typeof json !== 'object' || json.error || !Array.isArray(json.items)) throw new Error(json?.error || this._t('Respuesta no válida'));
				const items = json.items.map(item => this._itemFromTuple(item));
				this._details.set(hostid, {t: Date.now(), items, unsupported: Number(json.unsupported) || 0});
				if (this._details.size > 25) this._details.delete(this._details.keys().next().value);
				const host = (this._payload?.hosts || []).find(row => row.hostid === hostid);
				if (host) {
					Object.assign(host, {items, unsupported: Number(json.unsupported) || 0, detail: true, detail_stale: false, detail_error: null});
					items.forEach(item => this._itemIndex.set(item.itemid, item));
					this._cache.delete(hostid);
				}
				return true;
			})
			.catch(error => {
				const host = (this._payload?.hosts || []).find(row => row.hostid === hostid);
				if (host) host.detail_error = String(error.message || error);
				return false;
			})
			.finally(() => this._detailPending.delete(hostid));
		this._detailPending.set(hostid, request);
		return request;
	}

	_renderWidget() {
		const root = this._body.querySelector('.laka-fortigate-root');
		if (!root) return;

		if (!this._payload) {
			root.innerHTML = `<div class="fg-empty"><strong>${this._e(this._t('No se pudo interpretar la información del widget.'))}</strong>${this._authorship()}</div>`;
			return;
		}

		const hosts = this._payload.hosts || [];
		if (!hosts.length) {
			root.innerHTML = `<div class="fg-empty"><strong>${this._e(this._t('No hay firewalls FortiGate para mostrar.'))}</strong><span>${this._e(this._t('Edite el widget y seleccione grupos de hosts o hosts vinculados con la plantilla oficial FortiGate by HTTP o FortiGate by SNMP.'))}</span>${this._authorship()}</div>`;
			return;
		}

		const W = WidgetLakaFortiGateOverview;
		const fleetEnabled = this._fleetEnabled();
		const valid = hosts.some(host => host.hostid === this._selected_hostid) || (fleetEnabled && this._selected_hostid === W.FLEET);
		if (!valid) {
			this._selected_hostid = fleetEnabled ? W.FLEET : hosts[0].hostid;
		}

		const rotation = this._rotationSeconds();
		const ordered = this._sortedHosts(hosts);
		const counters = this._fleetCounters(hosts);

		root.innerHTML = `
			<div class="fg-shell ${this._sidebar_collapsed ? 'is-sidebar-collapsed' : ''}" lang="${this._locale()}">
				<aside class="fg-sidebar">
					<div class="fg-sidebar-top"><div class="fg-brand"><span class="fg-shield">F</span><div><strong>FortiGate</strong><small>Security Operations</small></div></div><button class="fg-sidebar-toggle" title="${this._e(this._t(this._sidebar_collapsed ? 'Ampliar menú' : 'Plegar menú'))}">${this._sidebar_collapsed ? '›' : '‹'}</button></div>
					${fleetEnabled ? `<button class="fg-host fg-fleet-button ${this._selected_hostid === W.FLEET ? 'is-active' : ''}" data-hostid="${W.FLEET}" title="${this._e(this._t('Lista de FortiGates'))}"><span class="fg-fleet-icon">▦</span><span class="fg-host-info"><strong>${this._e(this._t('Lista de FortiGates'))}</strong><small>${this._e(this._t('{0} firewalls · {1} críticos · {2} advertencias', hosts.length, counters.crit, counters.warn))}</small></span></button>` : ''}
					<div class="fg-sidebar-tools"><label class="fg-search"><span>⌕</span><input type="search" placeholder="${this._e(this._t('Buscar firewall…'))}"></label><select class="fg-sort" title="${this._e(this._t('Orden de la lista'))}"><option value="name" ${this._sidebarSort === 'name' ? 'selected' : ''}>A-Z</option><option value="severity" ${this._sidebarSort === 'severity' ? 'selected' : ''}>${this._e(this._t('Severidad'))}</option></select></div>
					<div class="fg-host-list">${ordered.map(host => this._hostButton(host)).join('')}</div>
					<div class="fg-rotation" title="${this._e(this._t('Periodo de visualización automática'))}"><span>↻</span><b>${rotation > 0 ? `${rotation}s` : 'OFF'}</b><small>${this._e(this._t('Rotación automática'))}</small></div>
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
		root.querySelector('.fg-sort').addEventListener('change', event => {
			this._sidebarSort = event.target.value;
			this._renderWidget();
		});
		root.querySelector('.fg-search input').addEventListener('input', event => {
			const needle = event.target.value.toLowerCase();
			root.querySelectorAll('.fg-host-list .fg-host').forEach(button => {
				button.hidden = !(button.dataset.search || '').includes(needle);
			});
		});

		this._renderMain(root.querySelector('.fg-main'));
	}

	_renderMain(container) {
		// La lista de FortiGates no tiene barra de pestañas: usa otra distribución de filas.
		container.classList.toggle('is-fleet', this._selected_hostid === WidgetLakaFortiGateOverview.FLEET);
		if (this._selected_hostid === WidgetLakaFortiGateOverview.FLEET) {
			this._renderFleet(container);
		}
		else {
			this._renderHost(container);
		}
	}

	_fleetEnabled() {
		return Number(this._payload?.settings?.show_fleet) === 1 && (this._payload?.hosts || []).length > 1;
	}

	_rotationSeconds() {
		const settings = this._payload?.settings || {};
		const seconds = Math.max(0, Number(settings.page_display_period) || 0);
		const pages = (this._payload?.hosts || []).length + (this._fleetEnabled() ? 1 : 0);
		return Number(settings.enable_auto_rotation) === 1 && seconds > 0 && pages > 1 ? Math.max(5, Math.min(3600, seconds)) : 0;
	}

	_sortedHosts(hosts) {
		if (this._sidebarSort !== 'severity') return hosts;
		const rank = {crit: 0, warn: 1, nodata: 2, maintenance: 3, ok: 4};
		return [...hosts].sort((a, b) => {
			const ha = this._hostHealth(a), hb = this._hostHealth(b);
			return (rank[ha.level] ?? 5) - (rank[hb.level] ?? 5) || this._problemBuckets(b).active.length - this._problemBuckets(a).active.length
				|| this._naturalCompare(a.name, b.name);
		});
	}

	_hostButton(host) {
		const data = this._data(host);
		const buckets = this._problemBuckets(host);
		const health = this._hostHealth(host);
		const model = data.model || 'FortiGate';
		const search = `${host.name} ${host.technical_name} ${model} ${data.firmware || ''} ${(host.groups || []).join(' ')}`.toLowerCase();
		return `<button class="fg-host ${host.hostid === this._selected_hostid ? 'is-active' : ''}" data-hostid="${this._e(host.hostid)}" data-search="${this._e(search)}" title="${this._e(host.name)} · ${this._e(model)}">
			<span class="fg-dot ${health.level}"></span><span class="fg-host-info"><strong>${this._e(host.name)}</strong><small>${this._e(model)} · ${this._e(health.label)}</small></span>
			${buckets.active.length ? `<b class="fg-count sev-bg-${this._maxSeverity(buckets.active)}">${buckets.active.length}</b>` : buckets.recovered.length ? `<b class="fg-count recovered" title="${this._e(this._t('{0} eventos recuperados pendientes de cierre', buckets.recovered.length))}">✓</b>` : ''}
		</button>`;
	}

	// Eventos comunes a la vista de flota y a la vista de firewall.
	_bindCommon(container) {
		container.querySelectorAll('[data-chart-items]').forEach(element => element.addEventListener('click', event => {
			if (event.target.closest('a')) return;
			this._openChart(element.dataset.chartTitle, element.dataset.chartItems.split(','), element.dataset.chartUnits || '');
		}));
		container.querySelectorAll('[data-goto-tab]').forEach(element => element.addEventListener('click', () => {
			this._selected_tab = element.dataset.gotoTab;
			this._renderMain(container);
		}));
		container.querySelectorAll('[data-goto-host]').forEach(element => element.addEventListener('click', event => {
			if (event.target.closest('a')) return;
			this._selected_hostid = element.dataset.gotoHost;
			this._selected_tab = 'overview';
			this._renderWidget();
			this._restartHostRotation();
		}));
		container.querySelectorAll('table[data-table] th[data-sort]').forEach(th => th.addEventListener('click', () => {
			const id = th.closest('table').dataset.table;
			const state = this._tableState[id] || {};
			this._tableState[id] = state.key === th.dataset.sort
				? {key: th.dataset.sort, dir: -(state.dir || 1)}
				: {key: th.dataset.sort, dir: Number(th.dataset.dir) || 1};
			this._renderMain(container);
		}));
		container.querySelectorAll('[data-table-search]').forEach(input => {
			const id = input.dataset.tableSearch;
			const apply = () => {
				const needle = input.value.trim().toLowerCase();
				this._tableSearch[id] = input.value;
				container.querySelectorAll(`table[data-table="${id}"] tbody tr`).forEach(row => {
					row.hidden = needle !== '' && !row.textContent.toLowerCase().includes(needle);
				});
			};
			input.value = this._tableSearch[id] || '';
			input.addEventListener('input', apply);
			apply();
		});
		container.querySelectorAll('[data-chip-group]').forEach(button => button.addEventListener('click', () => {
			const group = button.dataset.chipGroup, value = button.dataset.chipValue;
			if (group === 'fleet') this._fleetFilter = value;
			if (group === 'severity') this._problemSeverity = Number(value);
			if (group === 'policy') this._policyFilter = value;
			this._renderMain(container);
		}));
		window.requestAnimationFrame(() => this._drawAllCharts());
	}

	_footer(left, right) {
		return `<footer class="fg-footer"><span class="fg-footer-info">${left}</span><span class="fg-footer-meta">${right}</span>${this._authorship()}</footer>`;
	}

	/* ------------------------------------------------------------------ vista de flota */

	_fleetCounters(hosts) {
		const counters = {crit: 0, warn: 0, ok: 0, nodata: 0, maintenance: 0};
		hosts.forEach(host => { counters[this._hostHealth(host).level]++; });
		return counters;
	}

	_renderFleet(container) {
		const settings = this._payload.settings;
		const hosts = this._payload.hosts;
		const rows = hosts.map(host => ({host, data: this._data(host), health: this._hostHealth(host), buckets: this._problemBuckets(host)}));
		const counters = this._fleetCounters(hosts);
		const sum = fn => rows.reduce((total, row) => total + (fn(row) || 0), 0);
		const problems = sum(row => row.buckets.active.length);
		const wanDown = sum(row => row.data.summary.wan_total - row.data.summary.wan_up);
		const slaBad = sum(row => row.data.summary.sla_bad);
		const licBad = rows.filter(row => ['warn', 'crit'].includes(row.data.summary.license_level)).length;
		const fwUpdates = rows.filter(row => row.data.summary.firmware_update).length;
		const haBad = rows.filter(row => row.data.summary.ha_level === 'crit').length;

		const filters = [
			['all', this._t('Todos'), rows.length],
			['problems', this._t('Con problemas'), rows.filter(row => row.buckets.active.length).length],
			['crit', this._t('Críticos'), counters.crit],
			['warn', this._t('Advertencia'), counters.warn],
			['nodata', this._t('Sin datos'), counters.nodata + counters.maintenance],
			['wan', this._t('WAN caída'), rows.filter(row => row.data.summary.wan_up < row.data.summary.wan_total).length],
			['license', this._t('Licencias'), licBad],
			['firmware', this._t('Firmware'), fwUpdates]
		];
		const visible = rows.filter(row => {
			switch (this._fleetFilter) {
				case 'problems': return row.buckets.active.length > 0;
				case 'crit': case 'warn': return row.health.level === this._fleetFilter;
				case 'nodata': return ['nodata', 'maintenance'].includes(row.health.level);
				case 'wan': return row.data.summary.wan_up < row.data.summary.wan_total;
				case 'license': return ['warn', 'crit'].includes(row.data.summary.license_level);
				case 'firmware': return row.data.summary.firmware_update;
				default: return true;
			}
		});

		const rank = {crit: 0, warn: 1, nodata: 2, maintenance: 3, ok: 4};
		const columns = [
			{id: 'state', label: this._t('Estado'), sort: r => (rank[r.health.level] ?? 5) * 1000 - r.buckets.active.length,
				render: r => `<span class="fg-health ${r.health.level}">${this._e(r.health.label)}</span>`},
			{id: 'name', label: 'Firewall', sort: r => r.host.name,
				render: r => `<strong>${this._e(r.host.name)}</strong><small>${this._e(this._hostAddress(r.host))}${r.data.location ? ` · ${this._e(r.data.location)}` : ''}</small>`},
			{id: 'model', label: this._t('Modelo / FortiOS'), sort: r => `${r.data.model || ''} ${r.data.firmware || ''}`,
				render: r => `${this._e(r.data.model || '—')}<small>${this._e(r.data.firmware || this._t('FortiOS sin datos'))}${r.data.summary.firmware_update ? ` <b class="fg-mini warn" title="${this._e(this._t('Hay versiones de firmware disponibles'))}">⬆</b>` : ''}</small>`},
			{id: 'uptime', label: 'Uptime', dir: -1, sort: r => this._num(r.data.uptime), render: r => this._uptime(this._num(r.data.uptime), true)},
			{id: 'cpu', label: 'CPU', dir: -1, sort: r => this._num(r.data.cpu), render: r => this._pctCell(this._num(r.data.cpu), settings.cpu_warn, settings.cpu_crit)},
			{id: 'mem', label: 'RAM', dir: -1, sort: r => this._num(r.data.memory_util), render: r => this._pctCell(this._num(r.data.memory_util), settings.memory_warn, settings.memory_crit)},
			{id: 'disk', label: this._t('Disco'), dir: -1, sort: r => r.data.summary.disk_used, render: r => this._pctCell(r.data.summary.disk_used, 100 - settings.disk_free_warn, 100 - settings.disk_free_crit)},
			{id: 'sessions', label: this._t('Sesiones'), dir: -1, sort: r => r.data.summary.sessions, render: r => this._compact(r.data.summary.sessions)},
			{id: 'rtt', label: 'ICMP', dir: -1, sort: r => r.data.summary.rtt, render: r => this._icmpCell(r.data)},
			{id: 'wan', label: 'WAN', sort: r => r.data.summary.wan_total ? r.data.summary.wan_up / r.data.summary.wan_total : null, render: r => this._ratioCell(r.data.summary.wan_up, r.data.summary.wan_total)},
			{id: 'sdwan', label: 'SLA SD-WAN', sort: r => r.data.summary.sla_total ? (r.data.summary.sla_total - r.data.summary.sla_bad) / r.data.summary.sla_total : null, render: r => this._ratioCell(r.data.summary.sla_total - r.data.summary.sla_bad, r.data.summary.sla_total)},
			{id: 'vpn', label: 'IPsec', sort: r => r.data.summary.vpn_total ? r.data.summary.vpn_up / r.data.summary.vpn_total : this._num(r.data.vpn_active), render: r => r.data.summary.vpn_total ? this._ratioCell(r.data.summary.vpn_up, r.data.summary.vpn_total, 'warn') : this._compact(this._num(r.data.vpn_active))},
			{id: 'ha', label: 'HA', sort: r => r.data.summary.ha_label, render: r => `<span class="fg-text-${r.data.summary.ha_level}">${this._e(r.data.summary.ha_label)}</span>`},
			{id: 'lic', label: this._t('Licencias'), sort: r => r.data.summary.license_days, render: r => this._licenseCell(r.data.summary)},
			{id: 'problems', label: this._t('Problemas'), dir: -1, sort: r => r.buckets.active.length * 10 + this._maxSeverity(r.buckets.active),
				render: r => r.buckets.active.length ? `<b class="fg-count sev-bg-${this._maxSeverity(r.buckets.active)}">${r.buckets.active.length}</b>` : '<span class="fg-text-ok">0</span>'}
		];

		const subtitle = [this._t('{0} firewalls', hosts.length)];
		if (this._payload.truncated) subtitle.push(this._t('limitado a {0}', settings.max_hosts));
		subtitle.push(this._t('{0} normales', counters.ok), this._t('{0} advertencia', counters.warn), this._t('{0} críticos', counters.crit));

		container.innerHTML = `
			<header class="fg-header">
				<div class="fg-title"><span class="fg-status-icon ${counters.crit ? 'crit' : counters.warn ? 'warn' : 'ok'}">◆</span><div><h2>${this._e(this._t('Lista de FortiGates'))}</h2><p>${this._e(subtitle.join(' · '))}</p></div></div>
				<div class="fg-header-actions"><a href="zabbix.php?action=problem.view&filter_set=1${hosts.map(h => `&hostids%5B%5D=${encodeURIComponent(h.hostid)}`).slice(0, 200).join('')}" target="_blank">${this._e(this._t('Problemas {0}', problems))}</a></div>
			</header>
			<section class="fg-content">
				<div class="fg-kpis fg-kpis-fleet">
					${this._statCard('Firewalls', hosts.length, this._t('{0} normales', counters.ok), 'neutral')}
					${this._statCard(this._t('Críticos'), counters.crit, this._t('Severidad alta o no disponibles'), counters.crit ? 'crit' : 'ok', 'crit')}
					${this._statCard(this._t('Advertencia'), counters.warn, this._t('Problemas de severidad media'), counters.warn ? 'warn' : 'ok', 'warn')}
					${this._statCard(this._t('Problemas activos'), problems, this._t('Sin contar Link down recuperados'), problems ? 'warn' : 'ok', 'problems')}
					${this._statCard(this._t('WAN caídas'), wanDown, this._t('Interfaces WAN no operativas'), wanDown ? 'crit' : 'ok', 'wan')}
					${this._statCard('SLA SD-WAN', slaBad, this._t('Enlaces fuera de umbral o caídos'), slaBad ? 'warn' : 'ok')}
					${this._statCard('HA', haBad, this._t('Clústeres sin sincronizar'), haBad ? 'crit' : 'ok')}
					${this._statCard(this._t('Licencias'), licBad, this._t('Vencidas o por vencer'), licBad ? 'warn' : 'ok', 'license')}
					${this._statCard(this._t('Firmware'), fwUpdates, this._t('Con actualización disponible'), fwUpdates ? 'warn' : 'ok', 'firmware')}
				</div>
				<article class="fg-panel fg-wide">
					<div class="fg-panel-title"><div><h3>${this._e(this._t('Estado de los FortiGates'))}</h3><p>${this._e(this._t('Clic en una fila para abrir el firewall · clic en un encabezado para ordenar'))}</p></div><label class="fg-inline-search"><span>⌕</span><input type="search" data-table-search="fleet" placeholder="${this._e(this._t('Filtrar…'))}"></label></div>
					<div class="fg-chips">${filters.map(([id, label, count]) => `<button data-chip-group="fleet" data-chip-value="${id}" class="${this._fleetFilter === id ? 'is-active' : ''}">${this._e(label)} <b>${count}</b></button>`).join('')}</div>
					${visible.length ? this._table('fleet', columns, visible, {sort: 'state', rowAttrs: r => `data-goto-host="${this._e(r.host.hostid)}"`}) : this._empty(this._t('Sin firewalls en este filtro'), this._t('Cambie el filtro para ver el resto de los FortiGates.'))}
				</article>
			</section>
			${this._footer(this._e(this._t('Actualizado {0}', this._age(this._payload.generated_at))), this._e(this._t('Umbrales: CPU {0}/{1}% · RAM {2}/{3}% · licencias {4}/{5} días', settings.cpu_warn, settings.cpu_crit, settings.memory_warn, settings.memory_crit, settings.license_warn_days, settings.license_crit_days)))}`;

		container.querySelectorAll('[data-fleet-filter]').forEach(card => card.addEventListener('click', () => {
			this._fleetFilter = card.dataset.fleetFilter;
			this._renderMain(container);
		}));
		this._bindCommon(container);
	}

	_statCard(label, value, detail, level, filter = '') {
		return `<div class="fg-kpi fg-stat ${level}" ${filter ? `data-fleet-filter="${filter}" role="button" tabindex="0"` : ''}><div class="fg-kpi-head"><span>${this._e(label)}</span><b class="fg-dot ${level === 'neutral' ? 'ok' : level}"></b></div><strong>${this._compact(value)}</strong><p>${this._e(detail)}</p></div>`;
	}

	_pctCell(value, warn, crit) {
		if (value === null || value === undefined) return '<span class="fg-muted">—</span>';
		const level = this._levelHigh(value, warn, crit);
		return `<span class="fg-cell-meter ${level}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></span><span class="fg-text-${level}">${this._fmt(value)}%</span>`;
	}

	_ratioCell(up, total, badLevel = 'crit') {
		if (!total) return '<span class="fg-muted">—</span>';
		const level = up >= total ? 'ok' : badLevel;
		return `<span class="fg-text-${level}">${up}/${total}</span>`;
	}

	_icmpCell(data) {
		const s = data.summary;
		if (s.ping === null) return '<span class="fg-muted">—</span>';
		if (s.ping === 0) return `<span class="fg-text-crit">${this._e(this._t('Sin respuesta'))}</span>`;
		const level = this._worst([this._levelHigh(s.rtt, this._payload.settings.icmp_rtt_warn, this._payload.settings.icmp_rtt_crit),
			this._levelHigh(s.loss, this._payload.settings.icmp_loss_warn, this._payload.settings.icmp_loss_crit)]);
		return `<span class="fg-text-${level === 'nodata' ? 'ok' : level}">${s.rtt === null ? 'OK' : `${this._fmt(s.rtt)} ms`}</span>${s.loss ? `<small>${this._e(this._t('{0}% pérdida', this._fmt(s.loss)))}</small>` : ''}`;
	}

	_licenseCell(summary) {
		if (!summary.license_total) return '<span class="fg-muted">—</span>';
		const days = summary.license_days;
		const label = summary.license_expired ? this._n(summary.license_expired, '{0} vencida', '{0} vencidas')
			: days === null ? this._t('Vigentes') : this._t('{0} días', Math.floor(days));
		return `<span class="fg-text-${summary.license_level}">${this._e(label)}</span>`;
	}

	/* ------------------------------------------------------------------ vista de firewall */

	_renderHost(container) {
		const host = this._payload.hosts.find(row => row.hostid === this._selected_hostid);
		const data = this._data(host);
		const settings = this._payload.settings;
		const buckets = this._problemBuckets(host);
		const tabs = this._tabs(data, settings, buckets);
		if (!tabs.some(tab => tab.id === this._selected_tab)) this._selected_tab = tabs[0]?.id || 'overview';

		// En modo ligero se solicita el detalle completo del firewall seleccionado.
		if ((!host.detail || host.detail_stale) && !host.detail_error && !this._detailPending.has(host.hostid)) {
			this._loadHostDetail(host.hostid).then(ok => {
				if (ok && this._selected_hostid === host.hostid && !this._modal) this._renderWidget();
				else if (!ok && this._selected_hostid === host.hostid) this._renderMain(this._body.querySelector('.fg-main'));
			});
		}
		const detailState = host.detail_error ? `<span class="fg-text-warn" title="${this._e(host.detail_error)}">${this._e(this._t('Detalle completo no disponible'))}</span>`
			: !host.detail ? `<span class="fg-loading">${this._e(this._t('Cargando detalle completo…'))}</span>`
			: host.detail_stale ? `<span class="fg-loading">${this._e(this._t('Actualizando detalle…'))}</span>` : '';

		const health = this._hostHealth(host);
		const badges = [];
		if (data.summary.firmware_update) badges.push(`<span class="fg-badge warn" title="${this._e(this._t('FortiGuard informa {0} versiones disponibles', this._num(data.firmware_avail)))}">⬆ ${this._e(this._t('Firmware disponible'))}</span>`);
		if (data.summary.ha_mode_value === 2 || data.summary.ha_mode_value === 3) badges.push(`<span class="fg-badge ${data.summary.ha_level}">HA ${this._e(data.summary.ha_label)}</span>`);
		if (host.maintenance) badges.push(`<span class="fg-badge maintenance">${this._e(this._t('En mantenimiento'))}</span>`);

		const footerInfo = [this._t('Actualizado {0}', this._age(this._payload.generated_at)), this._t('{0} ítems', data.items_total)];
		if (data.unsupported_count) footerInfo.push(this._t('{0} no soportados', data.unsupported_count));

		container.innerHTML = `
			<header class="fg-header">
				<div class="fg-title"><span class="fg-status-icon ${health.level}">◆</span><div><h2>${this._e(host.name)}</h2><p>${this._e(data.model || host.technical_name)} · ${this._e(data.firmware || this._t('FortiOS sin datos'))} · ${this._e(this._hostAddress(host))} <span class="fg-source">${this._e(data.source)}</span> ${badges.join(' ')}</p></div></div>
				<div class="fg-header-actions"><span class="fg-health ${health.level}">${this._e(health.label)}</span><a href="zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=${encodeURIComponent(host.hostid)}" target="_blank">${this._e(this._t('Problemas {0}', buckets.active.length))}</a><a href="zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=${encodeURIComponent(host.hostid)}" target="_blank">${this._e(this._t('Últimos datos'))}</a><a href="zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=${encodeURIComponent(host.hostid)}" target="_blank">${this._e(this._t('Gráficas'))}</a></div>
			</header>
			<nav class="fg-tabs">${tabs.map(tab => `<button data-tab="${tab.id}" class="${this._selected_tab === tab.id ? 'is-active' : ''} ${tab.level ? `has-${tab.level}` : ''}">${tab.icon}<span>${this._e(tab.label)}</span>${tab.count !== null ? `<b>${tab.count}</b>` : ''}</button>`).join('')}</nav>
			<section class="fg-content">${this._tabContent(this._selected_tab, data, host, settings)}</section>
			${this._footer(`${this._e(footerInfo.join(' · '))} ${detailState}`, this._e(this._t('Gráficas: 1 h · histórico bajo demanda hasta {0} h', settings.history_hours)))}`;

		container.querySelectorAll('.fg-tabs button').forEach(button => button.addEventListener('click', () => {
			this._selected_tab = button.dataset.tab;
			this._renderHost(container);
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
		this._bindWanEditor(container, host);
		this._bindInterfaceEditor(container, host);
		this._bindCommon(container);
	}

	// Pestañas visibles según la configuración y los datos disponibles del firewall.
	_tabs(data, settings, buckets) {
		const s = data.summary, tabs = [];
		const add = (enabled, id, label, icon, count = null, level = '') => { if (enabled) tabs.push({id, label: this._t(label), icon, count, level}); };
		add(settings.show_overview, 'overview', 'Resumen', '◈');
		add(settings.show_problems, 'problems', 'Problemas', '⚠', buckets.active.length, buckets.active.length ? (this._maxSeverity(buckets.active) >= 4 ? 'crit' : 'warn') : '');
		add(settings.show_interfaces && data.all_interfaces.length, 'interfaces', 'Interfaces', '⇄', data.interfaces.length);
		add(settings.show_sdwan && (data.sdwan.length || data.sdwan_members.length), 'sdwan', 'SD-WAN', '⌁', data.sdwan.length || data.sdwan_members.length, s.sla_bad ? 'warn' : '');
		add(settings.show_vpn && (data.vpns.length || data.vpn_active || data.vpn_users), 'vpn', 'VPN', '◇', data.vpns.length || null, s.vpn_up < s.vpn_total ? 'warn' : '');
		add(settings.show_security && (data.security.length || data.ips_db), 'security', 'Seguridad', '⬡');
		add(settings.show_ha && data.ha.length && (s.ha_mode_value === 2 || s.ha_mode_value === 3 || data.ha.length > 1), 'ha', 'HA', '⛓', data.ha.length, s.ha_level === 'crit' ? 'crit' : '');
		add(settings.show_policies && data.policies.length, 'policies', 'Políticas', '☰', data.policies.length);
		add(settings.show_licenses && data.licenses.length, 'licenses', 'Licencias', '✦', data.licenses.length, ['warn', 'crit'].includes(s.license_level) ? s.license_level : '');
		add(settings.show_wireless && data.aps.length, 'wireless', 'FortiAP', '⌔', data.aps.length, s.ap_total > s.ap_online ? 'warn' : '');
		add(settings.show_sensors && data.sensors.length, 'sensors', 'Sensores', '♨', data.sensors.length, s.sensor_alarms ? 'crit' : '');
		add(settings.show_vdom && data.vdom.length, 'vdom', 'VDOM', '▦', data.vdom.length);
		add(settings.show_system, 'system', 'Sistema', '⚙', null, data.data_errors.length || data.unsupported_count ? 'warn' : '');
		if (!tabs.length) tabs.push({id: 'overview', label: this._t('Resumen'), icon: '◈', count: null, level: ''});
		return tabs;
	}

	_tabContent(tab, data, host, settings) {
		switch (tab) {
			case 'problems': return this._problemsView(host, data);
			case 'interfaces': return this._interfacesView(data, settings);
			case 'sdwan': return this._sdwanView(data, settings);
			case 'vpn': return this._vpnView(data);
			case 'security': return this._securityView(data);
			case 'ha': return this._haView(data);
			case 'policies': return this._policiesView(data, settings);
			case 'licenses': return this._licensesView(data, settings);
			case 'wireless': return this._wirelessView(data, settings);
			case 'sensors': return this._sensorsView(data, settings);
			case 'vdom': return this._vdomView(data);
			case 'system': return this._systemView(data, settings);
			default: return this._overviewView(data, host, settings);
		}
	}

	_panelTitle(title, subtitle, actions = '') {
		return `<div class="fg-panel-title"><div><h3>${this._e(title)}</h3>${subtitle ? `<p>${this._e(subtitle)}</p>` : ''}</div>${actions}</div>`;
	}

	_searchBox(id, placeholder = 'Filtrar…') {
		return `<label class="fg-inline-search"><span>⌕</span><input type="search" data-table-search="${id}" placeholder="${this._e(this._t(placeholder))}"></label>`;
	}

	/* ------------------------------------------------------------------ resumen */

	_overviewView(data, host, settings) {
		const s = data.summary;
		const buckets = this._problemBuckets(host);
		const memoryTotal = this._num(data.memory_total);
		const memoryUsed = this._num(data.memory_used) ?? (memoryTotal !== null && s.memory !== null ? memoryTotal * s.memory / 100 : null);
		const wan = data.interfaces.filter(row => row.is_wan);
		const kpis = [
			this._metricCard('CPU', s.cpu, '%', settings.cpu_warn, settings.cpu_crit, data.cpu, this._t('Uso de CPU'), s.cpu_cores ? this._t('{0} núcleos · máx. {1}%', s.cpu_cores, this._fmt(s.cpu_core_max)) : ''),
			this._metricCard(this._t('Memoria'), s.memory, '%', settings.memory_warn, settings.memory_crit, data.memory_util, this._t('Uso de memoria'), memoryTotal ? `${this._bytes(memoryUsed)} / ${this._bytes(memoryTotal)}` : ''),
			this._metricCard(this._t('Disco utilizado'), s.disk_used, '%', 100 - settings.disk_free_warn, 100 - settings.disk_free_crit, data.disk_util || data.disk_free_pct, this._t('Espacio de disco'), this._num(data.disk_free) !== null ? this._t('{0} libres', this._bytes(this._num(data.disk_free))) : '')
		];
		if (s.sessions !== null) kpis.push(this._numberCard(this._t(data.sessions ? 'Sesiones IPv4' : 'Sesiones SD-WAN'), s.sessions, data.sessions, this._t(data.sessions ? 'Sesiones activas' : 'Suma de miembros SD-WAN')));
		if (s.ping !== null) kpis.push(this._icmpCard(data, settings));
		if (settings.show_vpn && (data.vpn_active || s.vpn_total)) kpis.push(this._numberCard('VPN IPsec', s.vpn_total ? s.vpn_up : this._num(data.vpn_active), data.vpn_active, s.vpn_total ? this._t('{0} de {1} túneles arriba', s.vpn_up, s.vpn_total) : this._t('Túneles activos'), s.vpn_up < s.vpn_total ? 'warn' : 'ok'));
		if (settings.show_vpn && data.vpn_users) kpis.push(this._numberCard(this._t('Usuarios SSL-VPN'), this._num(data.vpn_users), data.vpn_users, this._t(this._num(data.vpn_ssl_state) === 1 ? 'SSL-VPN deshabilitada' : 'Usuarios conectados')));
		if (settings.show_wireless && s.ap_total) kpis.push(this._numberCard(this._t('Clientes Wi-Fi'), s.wifi_clients, null, this._t('{0} de {1} FortiAP en línea', s.ap_online, s.ap_total), s.ap_online < s.ap_total ? 'warn' : 'ok'));

		const problemsSubtitle = [this._t('{0} activos', buckets.active.length)];
		if (buckets.recovered.length) problemsSubtitle.push(this._t('{0} recuperados pendientes', buckets.recovered.length));

		return `
			<div class="fg-kpis">${kpis.join('')}</div>
			<div class="fg-overview-grid">
				<article class="fg-panel">${this._panelTitle(this._t('Salud del equipo'), this._t('Verificaciones calculadas con los datos de las plantillas · clic para ver el detalle'))}
					<div class="fg-checks">${this._healthChecks(data, host, settings).map(check => `<div class="fg-check ${check.level}" ${check.tab ? `data-goto-tab="${check.tab}" role="button" tabindex="0"` : ''} title="${this._e(check.detail || '')}"><i></i><span>${this._e(check.label)}</span><strong>${this._e(check.value)}</strong></div>`).join('')}</div>
				</article>
				<article class="fg-panel">${this._panelTitle(this._t('Problemas actuales'), problemsSubtitle.join(' · '), buckets.active.length > 6 ? `<button class="fg-config-button" data-goto-tab="problems">${this._e(this._t('Ver todos'))}</button>` : '')}
					${buckets.active.length ? `<div class="fg-problems">${buckets.active.slice(0, 6).map(p => this._problemRow(p, data)).join('')}</div>` : `<div class="fg-all-good">✓ ${this._e(this._t('Sin problemas operativos actuales'))}</div>`}
					${this._recoveredGroup(buckets.recovered.slice(0, 8), buckets.recovered.length, data)}
				</article>
			</div>
			${settings.show_interface_map && data.interfaces.length ? this._interfaceMap(data, settings) : ''}
			<article class="fg-panel fg-wan-panel">${this._panelTitle(this._t('Consumo de interfaces WAN'), this._t('Entrada y salida durante la última hora · clic para ampliar'), `<div class="fg-panel-actions"><span class="fg-chip">${wan.length} WAN</span><button class="fg-config-button" data-wan-editor-toggle title="${this._e(this._t('Personalizar las interfaces WAN únicamente para {0}', host.name))}">⚙ ${this._e(this._t('Configurar WAN'))}</button></div>`)}
				<div class="fg-wan-editor" hidden><label>${this._e(this._t('Interfaces adicionales de'))} <strong>${this._e(host.name)}</strong><input type="text" data-wan-editor-input value="${this._e([...this._hostWanSet(host.hostid)].join(', '))}" placeholder="port1, port12, x4"></label><small>${this._e(this._t('Separe los nombres con comas. Esta selección sólo afecta a este firewall y se conserva al recargar.'))}</small><div><button data-wan-editor-save>${this._e(this._t('Guardar'))}</button><button data-wan-editor-clear>${this._e(this._t('Limpiar'))}</button><button data-wan-editor-cancel>${this._e(this._t('Cancelar'))}</button></div></div>
				${wan.length ? `<div class="fg-wan-grid">${wan.map(row => this._wanCard(row, settings)).join('')}</div>` : this._empty(this._t('No se identificaron interfaces WAN'), this._t('Agregue sus nombres o ajuste la expresión WAN en la configuración del widget.'))}
			</article>`;
	}

	_recoveredGroup(problems, total, data, linkDown = false) {
		if (!total) return '';
		const summary = linkDown
			? this._n(total, '{0} evento Link down recuperado · pendiente de cierre en Zabbix', '{0} eventos Link down recuperados · pendientes de cierre en Zabbix')
			: this._n(total, '{0} evento recuperado · pendiente de cierre en Zabbix', '{0} eventos recuperados · pendientes de cierre en Zabbix');
		return `<details class="fg-recovered-group"><summary>${this._e(summary)}</summary><div class="fg-problems">${problems.map(p => this._problemRow(p, data)).join('')}</div></details>`;
	}

	// Lista de verificaciones de salud del firewall, cada una enlazada a su pestaña.
	_healthChecks(data, host, settings) {
		const s = data.summary, checks = [];
		const now = Date.now() / 1000, staleSeconds = Math.max(1, Number(settings.stale_minutes) || 15) * 60;

		if (s.ping !== null) {
			const level = s.ping === 0 ? 'crit' : this._worst([
				this._levelHigh(s.rtt, settings.icmp_rtt_warn, settings.icmp_rtt_crit),
				this._levelHigh(s.loss, settings.icmp_loss_warn, settings.icmp_loss_crit)
			]).replace('nodata', 'ok');
			let value = this._t('Sin respuesta');
			if (s.ping !== 0) {
				value = s.rtt === null ? this._t('Responde') : `${this._fmt(s.rtt)} ms`;
				if (s.loss !== null) value += ` · ${this._t('{0}% pérdida', this._fmt(s.loss))}`;
			}
			checks.push({label: this._t('Disponibilidad ICMP'), level, tab: 'system', value});
		}

		s.collectors.forEach(collector => {
			const value = this._num(collector.item);
			const stale = collector.item?.lastclock && now - collector.item.lastclock > staleSeconds;
			checks.push({label: this._t('Recolección {0}', collector.label), tab: 'system',
				level: value === 1 ? (stale ? 'warn' : 'ok') : value === 0 ? 'crit' : 'nodata',
				value: value === 1 ? (stale ? this._t('Sin datos nuevos {0}', this._age(collector.item.lastclock)) : this._t('Disponible')) : value === 0 ? this._t('Sin respuesta') : this._t('Desconocido'),
				detail: collector.item ? this._t('Último dato {0}', this._age(collector.item.lastclock)) : ''});
		});
		if (s.api_port !== null) checks.push({label: this._t('Puerto API'), level: s.api_port === 1 ? 'ok' : 'crit', value: this._t(s.api_port === 1 ? 'Abierto' : 'Cerrado'), tab: 'system'});

		const uptime = this._num(data.uptime);
		if (uptime !== null) checks.push({label: 'Uptime', level: uptime < 3600 ? 'warn' : 'ok', tab: 'system',
			value: uptime < 3600 ? this._t('Reinicio reciente · {0}', this._uptime(uptime)) : this._uptime(uptime)});

		if (s.wan_total) checks.push({label: this._t('Interfaces WAN'), level: s.wan_up < s.wan_total ? 'crit' : 'ok', value: this._t('{0} de {1} operativas', s.wan_up, s.wan_total), tab: 'interfaces'});
		if (s.sla_total) checks.push({label: 'SLA SD-WAN', level: s.sla_dead ? 'crit' : s.sla_bad ? 'warn' : 'ok',
			value: s.sla_bad ? this._t('{0} de {1} fuera de SLA', s.sla_bad, s.sla_total) : this._t('{0} enlaces dentro de SLA', s.sla_total), tab: 'sdwan'});
		if (s.vpn_total) checks.push({label: this._t('Túneles IPsec'), level: s.vpn_up < s.vpn_total ? 'warn' : 'ok', value: this._t('{0} de {1} arriba', s.vpn_up, s.vpn_total), tab: 'vpn'});
		if (s.ha_mode_value !== null) checks.push({label: this._t('Alta disponibilidad'), level: s.ha_level, value: s.ha_label, detail: s.ha_detail, tab: data.ha.length ? 'ha' : null});
		if (s.license_total) checks.push({label: this._t('Licencias FortiGuard'), level: s.license_level, tab: 'licenses',
			value: s.license_expired ? this._n(s.license_expired, '{0} vencida o no válida', '{0} vencidas o no válidas')
				: s.license_soon ? this._t('{0} por vencer · {1} días', s.license_soon, Math.floor(s.license_days)) : this._t('{0} vigentes', s.license_total)});
		if (data.firmware_avail) checks.push({label: this._t('Firmware'), level: s.firmware_update ? 'warn' : 'ok', tab: 'system',
			value: s.firmware_update ? this._t('{0} versiones disponibles', this._num(data.firmware_avail)) : this._t('Sin actualizaciones')});
		if (data.sensors.length) checks.push({label: this._t('Sensores de hardware'), level: s.sensor_alarms ? 'crit' : 'ok', tab: 'sensors',
			value: s.sensor_alarms ? this._t('{0} en alarma', s.sensor_alarms) : this._t('{0} normales', data.sensors.length)});
		if (s.ap_total) checks.push({label: 'FortiAP', level: s.ap_online < s.ap_total ? 'warn' : 'ok', tab: 'wireless', value: this._t('{0} de {1} en línea', s.ap_online, s.ap_total)});
		if (s.policies_total) checks.push({label: this._t('Políticas sin uso'), level: s.policies_unused ? 'info' : 'ok', tab: 'policies',
			value: this._t('{0} de {1} (> {2} días)', s.policies_unused, s.policies_total, settings.policy_unused_days)});
		checks.push({label: this._t('Calidad de datos'), tab: 'system',
			level: data.data_errors.length ? 'warn' : data.unsupported_count ? 'info' : 'ok',
			value: data.data_errors.length || data.unsupported_count
				? `${this._n(data.data_errors.length, '{0} error', '{0} errores')} · ${this._n(data.unsupported_count, '{0} no soportado', '{0} no soportados')}`
				: this._t('{0} ítems correctos', data.items_total)});
		return checks;
	}

	_icmpCard(data, settings) {
		const s = data.summary;
		const level = s.ping === 0 ? 'crit' : this._worst([this._levelHigh(s.rtt, settings.icmp_rtt_warn, settings.icmp_rtt_crit),
			this._levelHigh(s.loss, settings.icmp_loss_warn, settings.icmp_loss_crit)]);
		const ids = [data.ping_rtt?.itemid, data.ping_loss?.itemid].filter(Boolean);
		return `<button class="fg-kpi ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="${this._e(this._t('Disponibilidad ICMP'))}"` : ''}><div class="fg-kpi-head"><span>${this._e(this._t('Latencia ICMP'))}</span><b class="fg-dot ${level}"></b></div><strong>${s.ping === 0 ? this._e(this._t('Caído')) : s.rtt === null ? '—' : this._fmt(s.rtt)}<small>${s.ping === 0 || s.rtt === null ? '' : 'ms'}</small></strong><p>${this._e(this._t('Pérdida {0} · Warn {1} ms', s.loss === null ? '—' : `${this._fmt(s.loss)}%`, settings.icmp_rtt_warn))}</p></button>`;
	}

	_metricCard(label, value, unit, warn, crit, item, title, detail = '') {
		const level = this._levelHigh(value, warn, crit);
		const itemid = item?.itemid || '';
		return `<button class="fg-kpi ${level}" ${itemid ? `data-chart-items="${itemid}" data-chart-title="${this._e(title)}" data-chart-units="${unit}"` : ''}>
			<div class="fg-kpi-head"><span>${this._e(label)}</span><b class="fg-dot ${level}"></b></div><strong>${value === null ? '—' : this._fmt(value)}<small>${unit}</small></strong>
			<div class="fg-meter"><i style="width:${Math.max(0, Math.min(100, value || 0))}%"></i></div><p>${this._e(detail || this._t('Advertencia {0} · Crítico {1}', `${warn}${unit}`, `${crit}${unit}`))}</p>
		</button>`;
	}

	// Tarjeta numérica; text reemplaza el número cuando el valor es un texto (versión, ON/OFF…).
	_numberCard(label, value, item, detail, level = 'neutral', text = null) {
		const itemid = item?.itemid || '';
		const main = text !== null ? `<strong class="fg-kpi-text">${this._e(text)}</strong>` : `<strong>${value === null || value === undefined ? '—' : this._compact(value)}</strong>`;
		return `<button class="fg-kpi ${level}" ${itemid ? `data-chart-items="${itemid}" data-chart-title="${this._e(label)}"` : ''}><div class="fg-kpi-head"><span>${this._e(label)}</span><b class="fg-dot ${level === 'neutral' ? 'ok' : level}"></b></div>${main}<p>${this._e(detail)}</p></button>`;
	}

	/* ------------------------------------------------------------------ interfaces */

	_interfaceMap(data, settings) {
		const rows = [...data.interfaces].sort((a, b) => this._naturalCompare(a.name, b.name));
		const states = rows.map(row => ({row, state: this._interfaceStatus(row.status, row)}));
		const up = states.filter(entry => entry.state.class.split(' ').includes('up')).length;
		const expected = states.filter(entry => entry.state.class === 'expected').length;
		const down = states.filter(entry => ['down', 'not-present', 'lower-down'].includes(entry.state.class)).length;
		const errors = rows.filter(row => this._ifErrors(row) > 0).length;
		const filters = [['up', 'UP'], ['all', this._t('Todas')], ['physical', this._t('Físicas')], ['wan', 'WAN'], ['sdwan', 'SD-WAN'], ['down', 'DOWN'], ['traffic', this._t('Con tráfico')], ['errors', this._t('Con errores')]];
		return `<article class="fg-panel fg-wide fg-interface-map">
			<div class="fg-panel-title fg-map-title"><div><h3>${this._e(this._t('Mapa de interfaces'))}</h3><p>${this._e(this._t('Estado actual, tráfico y función de cada puerto · clic para abrir el histórico'))}</p></div>
				<div class="fg-map-controls"><div class="fg-map-summary"><span><i class="up"></i>${up} UP</span><span><i class="down"></i>${down} DOWN</span><span><i class="expected"></i>${this._e(this._t('{0} esperadas', expected))}</span><span><i class="errors"></i>${this._e(this._t('{0} con errores', errors))}</span>${data.hidden_interfaces ? `<span>${this._e(this._t('{0} ocultas', data.hidden_interfaces))}</span>` : ''}${data.grouped_interfaces ? `<span>${this._e(this._t('{0} agrupadas', data.grouped_interfaces))}</span>` : ''}</div><button class="fg-config-button" data-interface-editor-toggle>⚙ ${this._e(this._t('Filtrar mapa'))}</button></div>
			</div>
			${this._interfaceEditor(data)}
			<div class="fg-map-filters">${filters.map(([id, label]) => `<button data-if-filter="${id}" class="${id === 'up' ? 'is-active' : ''}">${this._e(label)}</button>`).join('')}</div>
			<div class="fg-port-grid">${rows.map(row => this._portCard(row, settings)).join('')}</div>
			<div class="fg-map-legend"><span><i class="up"></i>${this._e(this._t('Operativa'))}</span><span><i class="idle"></i>${this._e(this._t('UP sin tráfico'))}</span><span><i class="down"></i>${this._e(this._t('Falla'))}</span><span><i class="expected"></i>${this._e(this._t('DOWN esperado'))}</span><span><i class="wan"></i>WAN</span><span><i class="sdwan"></i>SD-WAN</span></div>
		</article>`;
	}

	_portCard(row, settings) {
		const state = this._interfaceStatus(row.status, row);
		const input = this._num(row.in), output = this._num(row.out), speed = this._num(row.speed);
		const traffic = Math.max(input || 0, output || 0);
		const errors = this._ifErrors(row);
		const util = speed ? traffic / speed * 100 : null;
		const level = this._levelHigh(util, settings.bandwidth_warn, settings.bandwidth_crit);
		const ids = [row.in?.itemid, row.out?.itemid].filter(Boolean);
		const stateClass = state.class.split(' ')[0];
		const tags = ['all', row.is_physical ? 'physical' : 'virtual', row.is_wan ? 'wan' : '', row.is_sdwan ? 'sdwan' : '', stateClass === 'up' ? 'up' : ['down', 'not-present', 'lower-down'].includes(stateClass) ? 'down' : stateClass, traffic > 0 ? 'traffic' : '', errors > 0 ? 'errors' : ''].filter(Boolean).join(' ');
		const lines = [`${row.name}${row.alias ? ` · ${row.alias}` : ''}`];
		if (row.duplicate_count > 1) lines.push(this._t('{0} índices agrupados', row.duplicate_count));
		lines.push(`${this._ifKindLabel(row.kind)} · ${state.label} · ${state.detail}`, `↓ ${this._bits(input)} · ↑ ${this._bits(output)}`,
			this._t('Velocidad {0} · Utilización {1}', this._bits(speed), util === null ? '—' : this._fmt(util) + '%'), this._t('Errores {0}/s', this._rate(errors)));
		return `<button class="fg-port ${stateClass} ${traffic > 0 ? 'has-traffic' : 'is-idle'} ${row.is_wan ? 'is-wan' : ''} ${row.is_sdwan ? 'is-sdwan' : ''} ${level}" data-if-tags="${tags}" title="${this._e(lines.join('\n'))}" ${stateClass === 'up' ? '' : 'hidden'} ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="${this._e(this._t('Interfaz {0}', row.name))}" data-chart-units="bps"` : 'disabled'}>
			<span class="fg-port-top"><strong>${this._e(row.name)}</strong>${row.duplicate_count > 1 ? `<em>×${row.duplicate_count}</em>` : ''}${row.is_wan ? '<b>WAN</b>' : row.is_sdwan ? '<b>SD</b>' : ''}</span>
			<span class="fg-port-jack"><i></i><i></i><i></i><i></i><i></i><i></i></span>
			<small>${this._e(row.alias || this._ifKindLabel(row.kind))}</small>
			<span class="fg-port-rate">↓ ${this._bits(input)}<br>↑ ${this._bits(output)}</span>
		</button>`;
	}

	_wanCard(row, settings) {
		const speed = this._num(row.speed), input = this._num(row.in), output = this._num(row.out);
		const peak = Math.max(input || 0, output || 0);
		const util = speed ? peak / speed * 100 : null;
		const level = this._levelHigh(util, settings.bandwidth_warn, settings.bandwidth_crit);
		const ids = [row.in?.itemid, row.out?.itemid].filter(Boolean);
		const state = this._interfaceStatus(row.status, row);
		return `<div class="fg-wan ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="WAN ${this._e(row.name)}" data-chart-units="bps"` : ''}>
			<div class="fg-wan-head"><div><strong>${this._e(row.name)}</strong><small>${this._e(row.alias || this._t('Interfaz WAN'))}</small></div><span class="fg-state ${state.class}" title="${this._e(state.detail)}">${this._e(state.label)}</span></div>
			<div class="fg-traffic-values"><span>↓ ${this._bits(input)}</span><span>↑ ${this._bits(output)}</span><b>${util === null ? '—' : this._fmt(util) + '%'}</b></div>
			<canvas class="fg-chart" data-series="${ids.join(',')}"></canvas><p>${this._e(this._t('Capacidad {0} · errores {1}/s · Warn {2}% · Crit {3}%', this._bits(speed), this._rate(this._ifErrors(row)), settings.bandwidth_warn, settings.bandwidth_crit))}</p>
		</div>`;
	}

	_interfacesView(data, settings) {
		const rows = data.interfaces.map(row => {
			const speed = this._num(row.speed), input = this._num(row.in), output = this._num(row.out);
			return {row, speed, input, output, state: this._interfaceStatus(row.status, row),
				util: speed ? Math.max(input || 0, output || 0) / speed * 100 : null,
				errors: this._ifErrors(row), discards: (this._num(row.in_discards) || 0) + (this._num(row.out_discards) || 0),
				packets: (this._num(row.in_packets) || 0) + (this._num(row.out_packets) || 0)};
		});
		const hasDiscards = data.interfaces.some(row => row.in_discards || row.out_discards);
		const hasPackets = data.interfaces.some(row => row.in_packets || row.out_packets);
		const columns = [
			{id: 'name', label: this._t('Interfaz'), sort: r => r.row.name, render: r => `<strong>${this._e(r.row.name)}</strong><small>${this._e(r.row.alias)}</small>`},
			{id: 'kind', label: this._t('Tipo'), sort: r => `${r.row.is_wan ? 0 : r.row.is_sdwan ? 1 : 2}${r.row.kind}`,
				render: r => `${r.row.is_wan ? '<span class="fg-chip wan">WAN</span> ' : ''}${r.row.is_sdwan ? '<span class="fg-chip sdwan">SD-WAN</span> ' : ''}${this._e(this._ifKindLabel(r.row.kind))}`},
			{id: 'state', label: this._t('Estado'), sort: r => r.state.label, render: r => `<span class="fg-state ${r.state.class}" title="${this._e(r.state.detail)}">${this._e(r.state.label)}</span>`},
			{id: 'speed', label: this._t('Velocidad'), dir: -1, sort: r => r.speed, render: r => this._bits(r.speed)},
			{id: 'in', label: this._t('Entrada'), dir: -1, sort: r => r.input, cls: 'in', render: r => `↓ ${this._bits(r.input)}`},
			{id: 'out', label: this._t('Salida'), dir: -1, sort: r => r.output, cls: 'out', render: r => `↑ ${this._bits(r.output)}`},
			{id: 'util', label: this._t('Utilización'), dir: -1, sort: r => r.util, render: r => this._pctCell(r.util, settings.bandwidth_warn, settings.bandwidth_crit)}
		];
		if (hasPackets) columns.push({id: 'pps', label: this._t('Paquetes/s'), dir: -1, sort: r => r.packets, render: r => this._compact(r.packets)});
		columns.push({id: 'errors', label: this._t('Errores/s'), dir: -1, sort: r => r.errors, render: r => `<span class="${r.errors > 0 ? 'fg-text-warn' : ''}">${this._rate(r.errors)}</span>`});
		if (hasDiscards) columns.push({id: 'discards', label: this._t('Descartes/s'), dir: -1, sort: r => r.discards, render: r => `<span class="${r.discards > 0 ? 'fg-text-warn' : ''}">${this._rate(r.discards)}</span>`});

		return `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Interfaces de red'), this._t('Clic en una fila para ver el tráfico histórico · clic en un encabezado para ordenar'), `<div class="fg-panel-actions">${this._searchBox('interfaces')}<span class="fg-chip">${this._e(this._t('{0} visibles', rows.length))}</span><button class="fg-config-button" data-interface-editor-toggle>⚙ ${this._e(this._t('Filtrar'))}</button></div>`)}
			${this._interfaceEditor(data)}
			${this._table('interfaces', columns, rows, {sort: 'kind', rowAttrs: r => {
				const ids = [r.row.in?.itemid, r.row.out?.itemid].filter(Boolean);
				return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="${this._e(this._t('Interfaz {0}', r.row.name))}" data-chart-units="bps"` : '';
			}})}</article>`;
	}

	/* ------------------------------------------------------------------ SD-WAN */

	_sdwanView(data, settings) {
		const parts = [];
		if (data.sdwan_members.length) {
			const columns = [
				{id: 'name', label: this._t('Miembro'), sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong><small>${this._e(this._t('Zona {0}', r.zone || '—'))}</small>`},
				{id: 'status', label: this._t('Configuración'), sort: r => this._num(r.status), render: r => this._num(r.status) === 1 ? `<span class="fg-state unknown">${this._e(this._t('Deshabilitado'))}</span>` : `<span class="fg-state up">${this._e(this._t('Habilitado'))}</span>`},
				{id: 'link', label: this._t('Enlace'), sort: r => this._num(r.link_status), render: r => { const st = this._sdwanLink(r.link_status); return `<span class="fg-state ${st.cls}">${st.label}</span>`; }},
				{id: 'rx', label: this._t('Recepción'), dir: -1, cls: 'in', sort: r => this._num(r.rx_bandwidth), render: r => `↓ ${this._bits(this._bpsFromBytes(r.rx_bandwidth))}`},
				{id: 'tx', label: this._t('Transmisión'), dir: -1, cls: 'out', sort: r => this._num(r.tx_bandwidth), render: r => `↑ ${this._bits(this._bpsFromBytes(r.tx_bandwidth))}`},
				{id: 'sessions', label: this._t('Sesiones'), dir: -1, sort: r => this._num(r.sessions), render: r => this._compact(this._num(r.sessions))},
				{id: 'changed', label: this._t('Último cambio'), dir: -1, sort: r => this._num(r.state_changed), render: r => this._num(r.state_changed) ? this._age(this._num(r.state_changed)) : '—'}
			];
			parts.push(`<article class="fg-panel fg-wide">${this._panelTitle(this._t('Miembros SD-WAN'), this._t('Estado del enlace, ancho de banda y sesiones por miembro (API HTTP)'), `<span class="fg-chip">${data.sdwan_members.length}</span>`)}
				${this._table('sdwan-members', columns, data.sdwan_members, {sort: 'name', rowAttrs: r => {
					const ids = [r.rx_bandwidth?.itemid, r.tx_bandwidth?.itemid].filter(Boolean);
					return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="SD-WAN ${this._e(r.name)}"` : '';
				}})}</article>`);
		}

		if (data.sdwan.length) {
			const checks = [...new Set(data.sdwan.map(row => row.health))].sort(this._naturalCompare);
			const members = [...new Set(data.sdwan.map(row => row.interface))].sort(this._naturalCompare);
			const cell = (health, member) => {
				const row = data.sdwan.find(entry => entry.health === health && entry.interface === member);
				if (!row) return '<td class="fg-sla-empty">—</td>';
				const level = this._slaLevel(row, settings);
				const ids = [row.latency?.itemid, row.jitter?.itemid, row.loss?.itemid].filter(Boolean);
				const state = this._sdwanState(row.state);
				return `<td class="fg-sla-cell ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="SLA ${this._e(health)} · ${this._e(member)}"` : ''} title="${this._e(`${health} · ${member}\n${this._t('Estado {0}', state)}`)}"><b>${state === 'alive' ? `${this._value(row.latency, ' ms')}` : state.toUpperCase()}</b><small>J ${this._value(row.jitter, ' ms')} · P ${this._value(row.loss, '%')}</small></td>`;
			};
			parts.push(`<article class="fg-panel fg-wide">${this._panelTitle(this._t('Matriz SLA'), this._t('Latencia, jitter (J) y pérdida (P) por health-check y miembro · umbrales {0}/{1} ms · {2}/{3} ms · {4}/{5}%', settings.latency_warn, settings.latency_crit, settings.jitter_warn, settings.jitter_crit, settings.loss_warn, settings.loss_crit))}
				<div class="fg-table-wrap"><table class="fg-table fg-sla-matrix"><thead><tr><th>Health-check</th>${members.map(member => `<th>${this._e(member)}</th>`).join('')}</tr></thead><tbody>${checks.map(health => `<tr><td><strong>${this._e(health)}</strong></td>${members.map(member => cell(health, member)).join('')}</tr>`).join('')}</tbody></table></div></article>`);

			parts.push(`<div class="fg-sdwan-grid">${data.sdwan.map(row => {
				const latency = this._num(row.latency), jitter = this._num(row.jitter), loss = this._num(row.loss);
				const level = this._slaLevel(row, settings);
				const ids = [row.latency?.itemid, row.jitter?.itemid, row.loss?.itemid].filter(Boolean);
				return `<article class="fg-panel fg-sdwan ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="SLA ${this._e(row.health)} · ${this._e(row.interface)}"` : ''}>
					<div class="fg-panel-title"><div><h3>${this._e(row.health)}</h3><p>${this._e(row.interface)}</p></div><span class="fg-state ${this._sdwanState(row.state)}">${this._sdwanState(row.state)}</span></div>
					<div class="fg-sla-values"><div><span>${this._e(this._t('Latencia'))}</span><strong>${latency === null ? '—' : this._fmt(latency)} ms</strong><small>${settings.latency_warn}/${settings.latency_crit} ms</small></div><div><span>Jitter</span><strong>${jitter === null ? '—' : this._fmt(jitter)} ms</strong><small>${settings.jitter_warn}/${settings.jitter_crit} ms</small></div><div><span>${this._e(this._t('Pérdida'))}</span><strong>${loss === null ? '—' : this._fmt(loss)}%</strong><small>${settings.loss_warn}/${settings.loss_crit}%</small></div></div>
					<canvas class="fg-chart tall" data-series="${ids.join(',')}"></canvas><p class="fg-note">${this._e(this._t('Sondas: {0}/s enviadas · {1}/s recibidas', this._rate(this._num(row.sent)), this._rate(this._num(row.received))))}</p>
				</article>`;
			}).join('')}</div>`);
		}
		return parts.join('');
	}

	_slaLevel(row, settings) {
		return this._worst([
			this._levelHigh(this._num(row.latency), settings.latency_warn, settings.latency_crit),
			this._levelHigh(this._num(row.jitter), settings.jitter_warn, settings.jitter_crit),
			this._levelHigh(this._num(row.loss), settings.loss_warn, settings.loss_crit),
			['dead', 'error'].includes(this._sdwanState(row.state)) ? 'crit' : 'ok'
		]);
	}

	/* ------------------------------------------------------------------ VPN y seguridad */

	_vpnView(data) {
		const s = data.summary;
		const sslState = this._num(data.vpn_ssl_state);
		const columns = [
			{id: 'name', label: this._t('Túnel'), sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong>`},
			{id: 'state', label: this._t('Estado'), sort: r => this._num(r.status), render: r => `<span class="fg-state ${this._vpnState(r.status)}">${this._vpnState(r.status)}</span>`},
			{id: 'age', label: this._t('Último dato'), dir: -1, sort: r => r.status?.lastclock, render: r => this._itemAge(r.status)}
		];
		return `<div class="fg-kpis">
				${this._numberCard(this._t('Túneles IPsec activos'), this._num(data.vpn_active), data.vpn_active, this._t('Con al menos una SA activa'))}
				${s.vpn_total ? this._numberCard(this._t('Túneles caídos'), s.vpn_total - s.vpn_up, null, this._t('De {0} túneles descubiertos', s.vpn_total), s.vpn_up < s.vpn_total ? 'warn' : 'ok') : ''}
				${this._numberCard(this._t('Usuarios SSL-VPN'), this._num(data.vpn_users), data.vpn_users, this._t('Sesiones actuales'))}
				${sslState !== null ? this._numberCard(this._t('Servicio SSL-VPN'), null, null, this._t(sslState === 2 ? 'Habilitado' : 'Deshabilitado'), sslState === 2 ? 'ok' : 'neutral', sslState === 2 ? 'ON' : 'OFF') : ''}
			</div>
			<article class="fg-panel fg-wide">${this._panelTitle(this._t('Túneles VPN descubiertos'), this._t('Estado individual informado por la MIB de Fortinet · caídos primero'), this._searchBox('vpn'))}
			${data.vpns.length ? this._table('vpn', columns, data.vpns, {sort: 'state'}) : this._empty(this._t('Sin túneles descubiertos'), this._t('El contador general puede existir aunque el descubrimiento no exponga el nombre de cada túnel.'))}</article>`;
	}

	_securityView(data) {
		const get = key => data.security.find(item => item.key_.startsWith(key));
		const levels = [['ips.detected.crit[', 'Críticas', 'crit'], ['ips.detected.high[', 'Altas', 'high'], ['ips.detected.med[', 'Medias', 'med'], ['ips.detected.low[', 'Bajas', 'low'], ['ips.detected.info[', 'Informativas', 'info']]
			.map(([key, label, cls]) => ({label: this._t(label), cls, item: get(key), value: this._num(get(key)) || 0}));
		const total = levels.reduce((sum, row) => sum + row.value, 0);
		const haAv = data.ha.reduce((sum, row) => sum + (this._num(row.av) || 0), 0);
		const haIps = data.ha.reduce((sum, row) => sum + (this._num(row.ips) || 0), 0);
		return `<div class="fg-kpis">
				${this._numberCard(this._t('Intrusiones bloqueadas/s'), null, get('ips.blocked['), this._t('Tasa calculada por Zabbix'), 'neutral', this._rate(this._num(get('ips.blocked['))))}
				${this._numberCard(this._t('Detecciones/s'), null, get('ips.detected.total['), this._t('Total de detecciones IPS'), 'neutral', this._rate(this._num(get('ips.detected.total['))))}
				${data.ips_db ? this._numberCard(this._t('Base de datos IPS'), null, null, this._t('Actualizada {0}', this._itemAge(data.ips_db)), 'neutral', data.ips_db.lastvalue || '—') : ''}
				${data.ha.length ? this._numberCard(this._t('Eventos AV/s (HA)'), null, null, this._t('IPS {0}/s en el clúster', this._rate(haIps)), 'neutral', this._rate(haAv)) : ''}
			</div>
			<article class="fg-panel fg-wide">${this._panelTitle(this._t('Distribución de detecciones IPS por severidad'), this._t('Tasa por segundo de los contadores SNMP; no sustituye el detalle de FortiAnalyzer'))}
				<div class="fg-stack">${total > 0 ? levels.filter(row => row.value > 0).map(row => `<i class="${row.cls}" style="flex:${row.value}" title="${this._e(row.label)}: ${this._rate(row.value)}/s"></i>`).join('') : '<i class="none" style="flex:1"></i>'}</div>
				<div class="fg-security-grid">${data.security.map(item => `<div ${item.value_type === 0 || item.value_type === 3 ? `data-chart-items="${item.itemid}" data-chart-title="${this._e(this._securityLabel(item.key_))}" role="button"` : ''}><span>${this._e(this._securityLabel(item.key_))}</span><strong>${this._num(item) === null ? this._e(item.lastvalue || '—') : this._rate(this._num(item))}</strong><small>${this._e(this._t('por segundo · {0}', this._itemAge(item)))}</small></div>`).join('')}</div>
			</article>`;
	}

	/* ------------------------------------------------------------------ alta disponibilidad */

	_haView(data) {
		const s = data.summary;
		const primary = s.ha_primary_serial;
		const checksums = new Set(data.ha.map(row => row.checksum?.lastvalue).filter(Boolean));
		const item = (label, value, cls = '') => `<span class="${cls}">${this._e(this._t(label))} <strong>${this._e(value)}</strong></span>`;
		return `<div class="fg-ha-summary">
				${item('Modo', this._haMode(data.ha_mode))}
				${item('Grupo', data.ha_group_name?.lastvalue || data.ha_group_id?.lastvalue || '—')}
				${item('Prioridad', data.ha_priority?.lastvalue ?? '—')}
				${item('Override', this._optionState(data.ha_override))}
				${item('Auto-sync', this._optionState(data.ha_auto_sync))}
				${item('Balanceo', this._haSchedule(data.ha_schedule))}
				${item('Checksum', checksums.size > 1 ? this._t('Diferente entre miembros') : checksums.size ? this._t('Consistente') : '—', `fg-text-${checksums.size > 1 ? 'crit' : 'ok'}`)}
			</div>
			<div class="fg-ha-grid">${data.ha.map(row => {
				const serial = row.serial?.lastvalue || '';
				const isPrimary = primary && serial && serial === primary;
				const sync = this._syncState(row.sync);
				const ids = [row.cpu?.itemid, row.memory?.itemid].filter(Boolean);
				return `<article class="fg-panel fg-ha-member ${isPrimary ? 'is-primary' : ''}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="HA ${this._e(row.hostname?.lastvalue || row.id)}" data-chart-units="%"` : ''}><div class="fg-panel-title"><div><h3>${this._e(row.hostname?.lastvalue || this._t('Miembro {0}', row.id))} ${primary ? `<span class="fg-chip ${isPrimary ? 'wan' : ''}">${this._e(this._t(isPrimary ? 'Primario' : 'Secundario'))}</span>` : ''}</h3><p>${this._e(serial || this._t('Serial sin datos'))}</p></div><span class="fg-state ${sync.cls}">${this._e(sync.label)}</span></div>
					<div class="fg-sla-values"><div><span>CPU</span><strong>${this._value(row.cpu, '%')}</strong></div><div><span>RAM</span><strong>${this._value(row.memory, '%')}</strong></div><div><span>${this._e(this._t('Sesiones'))}</span><strong>${this._compact(this._num(row.sessions))}</strong></div></div>
					<div class="fg-facts">${this._fact(this._t('Ancho de banda'), this._bits(this._num(row.network)), 'neutral')}${this._fact(this._t('Tráfico procesado'), this._bits(this._bpsFromBytes(row.bytes)), 'neutral')}${this._fact(this._t('Paquetes/s'), this._compact(this._num(row.packets)), 'neutral')}${this._fact(this._t('Eventos IPS/s'), this._rate(this._num(row.ips)), 'neutral')}${this._fact(this._t('Eventos AV/s'), this._rate(this._num(row.av)), 'neutral')}${this._fact('Checksum', row.checksum?.lastvalue ? String(row.checksum.lastvalue).slice(0, 16) : '—', checksums.size > 1 ? 'crit' : 'neutral')}</div></article>`;
			}).join('')}</div>`;
	}

	/* ------------------------------------------------------------------ políticas de firewall */

	_policiesView(data, settings) {
		const now = Date.now() / 1000, unusedSeconds = Math.max(1, Number(settings.policy_unused_days) || 90) * 86400;
		const rows = data.policies.map(row => {
			const lastUsed = this._num(row.last_used);
			const bytes = this._num(row.bytes), hw = this._num(row.hw_bytes);
			return {...row, lastUsed, unused: !lastUsed || now - lastUsed > unusedSeconds,
				disabled: this._num(row.status) === 1, action: this._policyAction(row.action),
				hitsValue: this._num(row.hits), bytesValue: bytes, sessionsValue: this._num(row.sessions),
				offload: bytes && hw !== null ? Math.min(100, hw / bytes * 100) : null};
		});
		const count = fn => rows.filter(fn).length;
		const filters = [['all', this._t('Todas'), rows.length], ['active', this._t('Con tráfico'), count(r => (r.hitsValue || 0) > 0 || (r.sessionsValue || 0) > 0)],
			['unused', this._t('Sin uso > {0} d', settings.policy_unused_days), count(r => r.unused && !r.disabled)], ['disabled', this._t('Deshabilitadas'), count(r => r.disabled)],
			['deny', 'Deny', count(r => r.action.id === 'deny')], ['ipsec', 'IPsec', count(r => r.action.id === 'ipsec')]];
		const visible = rows.filter(r => {
			switch (this._policyFilter) {
				case 'active': return (r.hitsValue || 0) > 0 || (r.sessionsValue || 0) > 0;
				case 'unused': return r.unused && !r.disabled;
				case 'disabled': return r.disabled;
				case 'deny': case 'ipsec': return r.action.id === this._policyFilter;
				default: return true;
			}
		});
		const columns = [
			{id: 'name', label: this._t('Política'), sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong>`},
			{id: 'action', label: this._t('Acción'), sort: r => r.action.label, render: r => `<span class="fg-state ${r.action.cls}">${r.action.label}</span>`},
			{id: 'status', label: this._t('Estado'), sort: r => r.disabled ? 1 : 0, render: r => r.disabled ? `<span class="fg-state unknown">${this._e(this._t('Deshabilitada'))}</span>` : `<span class="fg-state up">${this._e(this._t('Habilitada'))}</span>`},
			{id: 'hits', label: 'Hits/s', dir: -1, sort: r => r.hitsValue, render: r => this._rate(r.hitsValue)},
			{id: 'bytes', label: this._t('Tráfico'), dir: -1, sort: r => r.bytesValue, render: r => this._bits(r.bytesValue === null ? null : r.bytesValue * 8)},
			{id: 'sessions', label: this._t('Sesiones'), dir: -1, sort: r => r.sessionsValue, render: r => this._compact(r.sessionsValue)},
			{id: 'offload', label: 'Offload HW', dir: -1, sort: r => r.offload, render: r => r.offload === null ? '—' : `${this._fmt(r.offload)}%`},
			{id: 'last', label: this._t('Último uso'), dir: -1, sort: r => r.lastUsed, render: r => r.lastUsed ? `<span class="${r.unused ? 'fg-text-warn' : ''}">${this._age(r.lastUsed)}</span>` : `<span class="fg-text-warn">${this._e(this._t('Nunca'))}</span>`}
		];
		return `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Políticas de firewall'), this._t('Hits y tráfico por segundo, sesiones activas, descarga a hardware (NP) y último uso · clic para ver el histórico'), this._searchBox('policies', 'Filtrar política…'))}
			<div class="fg-chips">${filters.map(([id, label, n]) => `<button data-chip-group="policy" data-chip-value="${id}" class="${this._policyFilter === id ? 'is-active' : ''}">${this._e(label)} <b>${n}</b></button>`).join('')}</div>
			${visible.length ? this._table('policies', columns, visible, {sort: 'hits', dir: -1, rowAttrs: r => {
				const ids = [r.hits?.itemid, r.sessions?.itemid].filter(Boolean);
				return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="${this._e(this._t('Política {0}', r.name))}"` : '';
			}}) : this._empty(this._t('Sin políticas en este filtro'), this._t('Cambie el filtro o revise la regla de descubrimiento de políticas.'))}</article>`;
	}

	/* ------------------------------------------------------------------ licencias FortiGuard */

	_licensesView(data, settings) {
		const rows = data.licenses.map(row => ({...row, info: this._licenseInfo(row, settings)}));
		const expireCell = r => {
			if (!r.info.expire) return `<span class="fg-muted">${this._e(this._t('Sin vencimiento'))}</span>`;
			const days = Math.floor(r.info.days);
			const note = r.info.days < 0 ? this._t('vencida hace {0} días', Math.abs(days)) : this._t('{0} días', days);
			return `${this._date(r.info.expire)}<small class="fg-text-${r.info.level}">${this._e(note)}</small>`;
		};
		const columns = [
			{id: 'name', label: this._t('Servicio'), sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong><small>${this._e(r.type?.lastvalue || r.key)}</small>`},
			{id: 'status', label: this._t('Licencia'), sort: r => r.info.rank, render: r => `<span class="fg-state ${r.info.cls}">${this._e(r.info.status)}</span>`},
			{id: 'expire', label: this._t('Vencimiento'), sort: r => r.info.days, render: expireCell},
			{id: 'version', label: this._t('Versión'), sort: r => r.version?.lastvalue, render: r => this._e(r.version?.lastvalue || '—')},
			{id: 'updated', label: this._t('Última actualización'), dir: -1, sort: r => this._num(r.update_time), render: r => this._num(r.update_time) ? `${this._date(this._num(r.update_time))}<small>${this._age(this._num(r.update_time))}</small>` : '—'},
			{id: 'result', label: this._t('Resultado'), sort: r => r.update_result?.lastvalue, render: r => `${this._e(r.update_result?.lastvalue || '—')}<small>${this._e(r.update_method?.lastvalue || '')}${this._num(r.update_attempt) ? ` · ${this._e(this._t('intento {0}', this._age(this._num(r.update_attempt))))}` : ''}</small>`}
		];
		const expired = rows.filter(r => r.info.level === 'crit').length, soon = rows.filter(r => r.info.level === 'warn').length;
		return `<div class="fg-kpis">
				${this._numberCard(this._t('Servicios FortiGuard'), rows.length, null, this._t('Descubiertos por la API HTTP'))}
				${this._numberCard(this._t('Vencidos / inválidos'), expired, null, this._t('Crítico < {0} días', settings.license_crit_days), expired ? 'crit' : 'ok')}
				${this._numberCard(this._t('Por vencer'), soon, null, this._t('Advertencia < {0} días', settings.license_warn_days), soon ? 'warn' : 'ok')}
				${data.summary.license_days !== null ? this._numberCard(this._t('Próximo vencimiento'), Math.floor(data.summary.license_days), null, this._t('días restantes'), data.summary.license_days_level) : ''}
			</div>
			<article class="fg-panel fg-wide">${this._panelTitle(this._t('Licencias y contratos FortiGuard'), this._t('Estado, vencimiento, versión de firmas y resultado de la última actualización'), this._searchBox('licenses'))}
			${this._table('licenses', columns, rows, {sort: 'expire'})}</article>`;
	}

	// Nivel de una licencia según su estado y los días que faltan para vencer.
	_licenseInfo(row, settings) {
		const code = this._num(row.license);
		const expire = this._num(row.expire) || null;
		const days = expire ? (expire - Date.now() / 1000) / 86400 : null;
		const L = WidgetLakaFortiGateOverview.LICENSE_LEVEL;
		let level = code === null ? 'nodata' : L.crit.includes(code) ? 'crit' : L.warn.includes(code) ? 'warn' : L.ok.includes(code) ? 'ok' : 'nodata';
		if (days !== null && level !== 'nodata') {
			if (days < Number(settings.license_crit_days)) level = 'crit';
			else if (days < Number(settings.license_warn_days) && level === 'ok') level = 'warn';
		}
		const statusText = WidgetLakaFortiGateOverview.LICENSE_STATUS[code];
		return {code, expire, days, level, rank: {crit: 0, warn: 1, ok: 2, nodata: 3}[level],
			status: statusText ? this._t(statusText) : (row.license?.lastvalue || this._t('Sin datos')),
			cls: {crit: 'down', warn: 'testing', ok: 'up', nodata: 'unknown'}[level]};
	}

	/* ------------------------------------------------------------------ FortiAP */

	_wirelessView(data, settings) {
		const s = data.summary;
		const columns = [
			{id: 'name', label: 'FortiAP', sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong><small>${this._e([r.location?.lastvalue, r.profile?.lastvalue].filter(Boolean).join(' · '))}</small>`},
			{id: 'state', label: this._t('Conexión'), sort: r => this._num(r['conn.status']), render: r => { const st = this._apState(r); return `<span class="fg-state ${st.cls}">${this._e(st.label)}</span>`; }},
			{id: 'model', label: this._t('Modelo / firmware'), sort: r => r.model?.lastvalue, render: r => `${this._e(r.model?.lastvalue || '—')}<small>${this._e(r['software.version']?.lastvalue || '')}</small>`},
			{id: 'ip', label: 'IP', sort: r => r['ip.addr']?.lastvalue, render: r => this._e(r['ip.addr']?.lastvalue || '—')},
			{id: 'clients', label: this._t('Clientes'), dir: -1, sort: r => this._num(r['clients.num']), render: r => this._compact(this._num(r['clients.num']))},
			{id: 'cpu', label: 'CPU', dir: -1, sort: r => this._num(r['cpu.usage']), render: r => this._pctCell(this._num(r['cpu.usage']), settings.cpu_warn, settings.cpu_crit)},
			{id: 'mem', label: 'RAM', dir: -1, sort: r => this._num(r['mem.usage']), render: r => this._pctCell(this._num(r['mem.usage']), settings.memory_warn, settings.memory_crit)},
			{id: 'radio', label: 'Radio', sort: r => this._num(r['radio.band']), render: r => `${this._e(this._band(r['radio.band']))}<small>${r['radio.power_level'] ? `TX ${this._value(r['radio.power_level'], '%')}` : ''}${this._num(r['radio.enabled']) === 1 ? ` · ${this._e(this._t('deshabilitada'))}` : ''}</small>`},
			{id: 'traffic', label: this._t('Tráfico'), dir: -1, sort: r => (this._num(r['rate.in']) || 0) + (this._num(r['rate.out']) || 0), render: r => `<span class="in">↓ ${this._bits(this._num(r['rate.in']))}</span><small class="out">↑ ${this._bits(this._num(r['rate.out']))}</small>`},
			{id: 'uptime', label: 'Uptime', dir: -1, sort: r => this._num(r.uptime), render: r => this._uptime(this._num(r.uptime), true)}
		];
		return `<div class="fg-kpis">
				${this._numberCard('FortiAP', s.ap_total, null, this._t('Puntos de acceso gestionados'))}
				${this._numberCard(this._t('En línea'), s.ap_online, null, this._t('{0} fuera de línea', s.ap_total - s.ap_online), s.ap_online < s.ap_total ? 'warn' : 'ok')}
				${this._numberCard(this._t('Clientes conectados'), s.wifi_clients, null, this._t('Suma de estaciones asociadas'))}
			</div>
			<article class="fg-panel fg-wide">${this._panelTitle(this._t('Puntos de acceso FortiAP'), this._t('Controlador inalámbrico del FortiGate (SNMP) · clic para ver tráfico y clientes'), this._searchBox('aps'))}
			${this._table('aps', columns, data.aps, {sort: 'state', rowAttrs: r => {
				const ids = [r['rate.in']?.itemid, r['rate.out']?.itemid].filter(Boolean);
				return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="FortiAP ${this._e(r.name)}" data-chart-units="bps"` : '';
			}})}</article>`;
	}

	_apState(row) {
		const conn = this._num(row['conn.status']), admin = this._num(row['admin.status']);
		if (admin === 2) return {cls: 'expected', label: this._t('Deshabilitado'), online: false};
		const states = {2: ['up', 'En línea', true], 1: ['down', 'Fuera de línea', false], 3: ['testing', 'Descargando imagen', true], 4: ['testing', 'Imagen conectada', true]};
		const [cls, label, online] = states[conn] || ['unknown', 'Desconocido', false];
		return {cls, label: this._t(label), online};
	}

	/* ------------------------------------------------------------------ sensores y VDOM */

	_sensorsView(data, settings) {
		const sensors = [...data.sensors].sort((a, b) => (this._num(b.status) || 0) - (this._num(a.status) || 0) || this._naturalCompare(a.name, b.name));
		return `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Sensores físicos'), this._t('El estado de alarma nativo tiene prioridad; los límites °C se aplican a valores identificados como temperatura'), `<span class="fg-chip">${data.sensors.length}</span>`)}<div class="fg-sensor-grid">${sensors.map(row => {
			const numeric = this._sensorNumber(row.value?.lastvalue);
			const isTemp = /(temp|thermal|hotspot|°c|\bdts\b|cpu\s*\d*\s*core|\btd\d|\bts\d)/i.test(row.name);
			const alarm = this._num(row.status) === 1;
			const level = alarm ? 'crit' : (isTemp ? this._levelHigh(numeric, settings.temperature_warn, settings.temperature_crit) : 'ok');
			const note = alarm ? this._t('Alarma reportada por el equipo') : isTemp ? `Warn ${settings.temperature_warn}°C · Crit ${settings.temperature_crit}°C` : this._t('Estado normal');
			return `<div class="fg-sensor ${level}"><span class="fg-sensor-icon">${isTemp ? '♨' : /(fan)/i.test(row.name) ? '✣' : /(psu|power|volt|vcc|\+\d)/i.test(row.name) ? 'ϟ' : '●'}</span><div><strong>${this._e(row.name)}</strong><span>${this._e(row.value?.lastvalue || this._t('Sin datos'))}</span><small>${this._e(note)}</small></div></div>`;
		}).join('')}</div></article>`;
	}

	_vdomView(data) {
		const columns = [
			{id: 'name', label: 'VDOM', sort: r => r.name, render: r => `<strong>${this._e(r.name)}</strong>`},
			{id: 'mode', label: this._t('Modo'), sort: r => this._num(r.mode), render: r => this._e(this._vdomMode(r.mode))},
			{id: 'ha', label: this._t('Rol HA'), sort: r => this._num(r.ha), render: r => this._e(this._vdomHa(r.ha))},
			{id: 'cpu', label: 'CPU', dir: -1, sort: r => this._num(r.cpu), render: r => this._value(r.cpu, '%')},
			{id: 'mem', label: 'RAM *', dir: -1, sort: r => this._num(r.memory), render: r => this._value(r.memory, '%')},
			{id: 'sessions', label: this._t('Sesiones'), dir: -1, sort: r => this._num(r.sessions), render: r => this._compact(this._num(r.sessions))},
			{id: 'rate', label: this._t('Sesiones/s'), dir: -1, sort: r => this._num(r.rate), render: r => this._compact(this._num(r.rate))}
		];
		return `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Dominios virtuales'), this._t('Recursos y sesiones por VDOM · clic para ver el histórico'))}
			${this._table('vdom', columns, data.vdom, {sort: 'name', rowAttrs: r => {
				const ids = [r.cpu?.itemid, r.sessions?.itemid].filter(Boolean);
				return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="VDOM ${this._e(r.name)}"` : '';
			}})}
			<p class="fg-note">* ${this._e(this._t('La plantilla oficial SNMP consulta fgVdEntCpuUsage para la memoria del VDOM; si RAM coincide con CPU, corrija el OID del prototipo a fgVdEntMemUsage.'))}</p></article>`;
	}

	/* ------------------------------------------------------------------ sistema y calidad de datos */

	_systemView(data, settings) {
		const s = data.summary;
		const now = Date.now() / 1000, staleSeconds = Math.max(1, Number(settings.stale_minutes) || 15) * 60;
		const bytes = item => this._num(item) !== null ? this._bytes(this._num(item)) : null;
		const facts = [
			['Nombre del sistema', data.sysname?.lastvalue], ['Modelo', data.model], ['Número de serie', data.serial], ['FortiOS', data.firmware],
			['Firmware disponible', data.firmware_avail ? (s.firmware_update ? this._t('{0} versiones', this._num(data.firmware_avail)) : this._t('Al día')) : null],
			['Uptime', this._num(data.uptime) !== null ? this._uptime(this._num(data.uptime)) : null], ['VDOM actual', data.vdom_current?.lastvalue],
			['Ubicación', data.location], ['Contacto', data.contact?.lastvalue], ['Descripción', data.descr?.lastvalue], ['Object ID', data.objectid?.lastvalue],
			['Número de CPU', data.cpu_num?.lastvalue], ['Memoria total', bytes(data.memory_total)], ['Memoria disponible', bytes(data.memory_available)],
			['Disco total', bytes(data.disk_total)], ['Disco usado', bytes(data.disk_used)], ['Base IPS', data.ips_db?.lastvalue],
			['SSL-VPN', this._num(data.vpn_ssl_state) === null ? null : this._t(this._num(data.vpn_ssl_state) === 2 ? 'Habilitada' : 'Deshabilitada')],
			['Grupos', (this._payload.hosts.find(h => h.hostid === data.hostid)?.groups || []).join(', ')]
		].filter(([, value]) => value !== null && value !== undefined && value !== '');

		const cores = data.cpu_cores;
		const stale = [data.cpu, data.memory_util, ...s.collectors.map(c => c.item)].filter(item => item && item.lastclock && now - item.lastclock > staleSeconds);
		const pingIds = [data.ping_rtt?.itemid, data.ping_loss?.itemid].filter(Boolean);
		const collectorState = item => this._num(item) === 1 ? this._t('Disponible') : this._num(item) === 0 ? this._t('Sin respuesta') : this._t('Desconocido');
		const collectorLevel = item => this._num(item) === 1 ? 'ok' : this._num(item) === 0 ? 'crit' : 'neutral';

		const socColumns = [
			{id: 'id', label: this._t('Procesador'), sort: r => r.id, render: r => `<strong>SoC3 ${this._e(r.id)}</strong>`},
			{id: 'rx', label: this._t('Recibidos/s'), dir: -1, sort: r => this._num(r.received), render: r => this._compact(this._num(r.received))},
			{id: 'tx', label: `${this._t('Transmitidos/s')} *`, dir: -1, sort: r => this._num(r.transmitted), render: r => this._compact(this._num(r.transmitted))},
			{id: 'drop', label: this._t('Descartados/s'), dir: -1, sort: r => this._num(r.dropped), render: r => `<span class="${this._num(r.dropped) > 0 ? 'fg-text-warn' : ''}">${this._rate(this._num(r.dropped))}</span>`}
		];

		return `<div class="fg-overview-grid">
				<article class="fg-panel">${this._panelTitle(this._t('Información del sistema'), this._t('Inventario reportado por FortiOS'))}<div class="fg-facts">${facts.map(([label, value]) => this._fact(this._t(label), String(value), 'neutral')).join('')}</div></article>
				<article class="fg-panel" ${pingIds.length ? `data-chart-items="${pingIds.join(',')}" data-chart-title="${this._e(this._t('Disponibilidad ICMP'))}"` : ''}>${this._panelTitle(this._t('Disponibilidad'), this._t(pingIds.length ? 'ICMP y recolectores de Zabbix · clic para ver el histórico' : 'ICMP y recolectores de Zabbix'))}
					<div class="fg-facts">
						${this._fact('ICMP', s.ping === null ? this._t('Sin ítem') : s.ping === 1 ? this._t('Responde') : this._t('Sin respuesta'), s.ping === 1 ? 'ok' : s.ping === 0 ? 'crit' : 'neutral')}
						${this._fact(this._t('Tiempo de respuesta'), s.rtt === null ? '—' : `${this._fmt(s.rtt)} ms`, this._levelHigh(s.rtt, settings.icmp_rtt_warn, settings.icmp_rtt_crit).replace('nodata', 'neutral'))}
						${this._fact(this._t('Pérdida'), s.loss === null ? '—' : `${this._fmt(s.loss)}%`, this._levelHigh(s.loss, settings.icmp_loss_warn, settings.icmp_loss_crit).replace('nodata', 'neutral'))}
						${s.collectors.map(c => this._fact(c.label, collectorState(c.item), collectorLevel(c.item))).join('')}
						${s.api_port !== null ? this._fact(this._t('Puerto API'), this._t(s.api_port === 1 ? 'Abierto' : 'Cerrado'), s.api_port === 1 ? 'ok' : 'crit') : ''}
					</div></article>
			</div>
			${cores.length ? `<article class="fg-panel fg-wide">${this._panelTitle(this._t('CPU por núcleo'), this._t('Promedio de 1 minuto · barra dividida en sistema y usuario · clic para ver el histórico'), `<span class="fg-chip">${this._e(this._t('{0} núcleos · máx. {1}%', cores.length, this._fmt(s.cpu_core_max)))}</span>`)}
				<div class="fg-core-grid">${cores.map(core => {
					const usage = this._num(core.usage), sys = this._num(core.sys), user = this._num(core.user);
					const level = this._levelHigh(usage, settings.cpu_warn, settings.cpu_crit);
					const ids = [core.usage?.itemid, core.sys?.itemid, core.user?.itemid].filter(Boolean);
					const title = this._t('Total {0} · sistema {1} · usuario {2}', this._value(core.usage, '%'), this._value(core.sys, '%'), this._value(core.user, '%'));
					return `<div class="fg-core ${level}" ${ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="CPU ${this._e(core.label)}" data-chart-units="%"` : ''} title="${this._e(title)}"><span>${this._e(core.label)}</span><div class="fg-core-bar">${sys !== null || user !== null ? `<i class="sys" style="width:${Math.min(100, sys || 0)}%"></i><i class="user" style="width:${Math.min(100, user || 0)}%"></i>` : `<i class="sys" style="width:${Math.min(100, usage || 0)}%"></i>`}</div><b class="fg-text-${level}">${this._value(core.usage, '%')}</b></div>`;
				}).join('')}</div><div class="fg-map-legend"><span><i class="sdwan"></i>${this._e(this._t('Sistema'))}</span><span><i class="wan"></i>${this._e(this._t('Usuario'))}</span></div></article>` : ''}
			${data.soc.length ? `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Procesador de red NP6lite (SoC3)'), this._t('Paquetes por segundo procesados en hardware'))}${this._table('soc', socColumns, data.soc, {sort: 'id', rowAttrs: r => { const ids = [r.received?.itemid, r.dropped?.itemid].filter(Boolean); return ids.length ? `data-chart-items="${ids.join(',')}" data-chart-title="SoC3 ${this._e(r.id)}"` : ''; }})}<p class="fg-note">* ${this._e(this._t('La plantilla oficial usa el OID de recepción para "transmitidos"; ambos valores coinciden hasta que se corrija.'))}</p></article>` : ''}
			<article class="fg-panel fg-wide">${this._panelTitle(this._t('Calidad de los datos'), this._t('Errores de recolección de la API, ítems no soportados y métricas sin datos recientes (> {0} min)', settings.stale_minutes), `<span class="fg-chip">${this._e(this._t('{0} ítems', data.items_total))}</span>`)}
				<div class="fg-facts fg-facts-3">${this._fact(this._t('Errores de API'), String(data.data_errors.length), data.data_errors.length ? 'warn' : 'ok')}${this._fact(this._t('Ítems no soportados'), String(data.unsupported_count), data.unsupported_count ? 'warn' : 'ok')}${this._fact(this._t('Métricas desactualizadas'), String(stale.length), stale.length ? 'warn' : 'ok')}</div>
				${data.data_errors.length ? `<div class="fg-issue-list">${data.data_errors.map(item => `<div class="warn"><strong>${this._e(item.name)}</strong><span>${this._e(item.lastvalue)}</span><small>${this._itemAge(item)}</small></div>`).join('')}</div>` : ''}
				${stale.length ? `<div class="fg-issue-list">${stale.map(item => `<div class="warn"><strong>${this._e(item.name)}</strong><span>${this._e(this._t('Último dato {0}', this._age(item.lastclock)))}</span><small>${this._e(item.key_)}</small></div>`).join('')}</div>` : ''}
				${data.unsupported.length ? `<details class="fg-issue-details"><summary>${this._e(this._n(data.unsupported.length, '{0} ítem no soportado', '{0} ítems no soportados'))}</summary><div class="fg-issue-list">${data.unsupported.slice(0, 60).map(item => `<div><strong>${this._e(item.name)}</strong><span>${this._e(item.error || this._t('Sin mensaje de error'))}</span><small>${this._e(item.key_)}</small></div>`).join('')}</div></details>` : ''}
				${!data.data_errors.length && !data.unsupported_count && !stale.length ? `<div class="fg-all-good">✓ ${this._e(this._t('Todos los ítems se recolectan correctamente'))}</div>` : ''}
			</article>`;
	}

	/* ------------------------------------------------------------------ problemas */

	_severityLabel(severity) {
		const label = WidgetLakaFortiGateOverview.SEVERITIES[severity];
		return label ? this._t(label) : String(severity);
	}

	_problemsView(host, data) {
		const buckets = this._problemBuckets(host);
		const minSeverity = this._problemSeverity;
		const rows = buckets.active.filter(problem => problem.severity >= minSeverity);
		const chips = [[0, this._t('Todas')], [2, `≥ ${this._severityLabel(2)}`], [3, `≥ ${this._severityLabel(3)}`], [4, `≥ ${this._severityLabel(4)}`], [5, this._severityLabel(5)]]
			.map(([value, label]) => `<button data-chip-group="severity" data-chip-value="${value}" class="${minSeverity === value ? 'is-active' : ''}">${this._e(label)} <b>${buckets.active.filter(p => p.severity >= value).length}</b></button>`).join('');
		const columns = [
			{id: 'severity', label: this._t('Severidad'), dir: -1, sort: p => p.severity, render: p => `<span class="fg-sev sev-bg-${p.severity}">${this._e(this._severityLabel(p.severity))}</span>`},
			{id: 'name', label: this._t('Problema'), sort: p => p.name, render: p => {
				const status = this._problemState(p, data);
				const extra = status.currentDown ? ` · ${this._t('interfaz {0} actual', status.state.label)}` : '';
				return `<a href="tr_events.php?triggerid=${encodeURIComponent(p.triggerid || '')}&eventid=${encodeURIComponent(p.eventid)}" target="_blank"><strong>${this._e(p.name)}</strong></a><small>${this._e((p.opdata || '') + extra)}</small>`;
			}},
			{id: 'age', label: this._t('Duración'), sort: p => p.clock, render: p => `${this._duration(p.clock)}<small>${this._date(p.clock)}</small>`},
			{id: 'ack', label: this._t('Reconocido'), sort: p => p.acknowledged ? 1 : 0, render: p => p.acknowledged ? `<span class="fg-text-ok">✓ ${this._e(this._t('Sí'))}</span>` : `<span class="fg-muted">${this._e(this._t('No'))}</span>`},
			{id: 'supp', label: this._t('Suprimido'), sort: p => p.suppressed ? 1 : 0, render: p => p.suppressed ? `<span class="fg-text-info">${this._e(this._t('Sí'))}</span>` : `<span class="fg-muted">${this._e(this._t('No'))}</span>`}
		];
		return `<article class="fg-panel fg-wide">${this._panelTitle(this._t('Problemas activos'), this._t('Los eventos Link down de interfaces que ya están UP se separan como recuperados · clic en el nombre para abrir el evento'), this._searchBox('problems'))}
			<div class="fg-chips">${chips}</div>
			${rows.length ? this._table('problems', columns, rows, {sort: 'severity', dir: -1}) : `<div class="fg-all-good">✓ ${this._e(this._t('Sin problemas para el filtro seleccionado'))}</div>`}
			${this._recoveredGroup(buckets.recovered, buckets.recovered.length, data, true)}
		</article>`;
	}

	_problemRow(problem, data) {
		const status = this._problemState(problem, data), state = status.state;
		const rowClass = status.recovered ? 'is-recovered' : status.currentDown ? 'is-current-down' : '';
		const flags = `${problem.acknowledged ? `<em class="fg-ack" title="${this._e(this._t('Reconocido'))}">✓</em>` : ''}${problem.suppressed ? `<em class="fg-supp" title="${this._e(this._t('Suprimido'))}">S</em>` : ''}`;
		const note = status.recovered ? `<em class="fg-recovered">${this._e(this._t('Recuperada · pendiente de cierre'))}</em><time>${this._age(problem.clock)}</time>`
			: status.currentDown ? `<em class="fg-current-down">${this._e(this._t('{0} actual', state.label))}</em><time>${this._age(problem.clock)}</time>`
			: `${flags}<time>${this._age(problem.clock)}</time>`;
		return `<div class="${rowClass}" title="${this._e(state?.detail || this._severityLabel(problem.severity))}"><span class="${status.recovered ? 'state-recovered' : `sev-${problem.severity}`}"></span><a href="tr_events.php?triggerid=${encodeURIComponent(problem.triggerid || '')}&eventid=${encodeURIComponent(problem.eventid)}" target="_blank"><strong>${this._e(problem.name)}</strong></a><small>${note}</small></div>`;
	}

	// Un "Link down" de una interfaz que ya está UP se considera recuperado.
	_problemState(problem, data) {
		const isLinkDown = /link down/i.test(problem.name);
		if (!isLinkDown) return {state: null, recovered: false, currentDown: false};
		const match = problem.name.match(/Interface\s+\[?([^\]():]+?)\s*\(/i), name = match?.[1]?.trim();
		const matches = name ? (data.all_interfaces || []).filter(item => item.name.trim().toLowerCase() === name.toLowerCase()) : [];
		const row = matches.sort((a, b) => this._interfaceScore(b) - this._interfaceScore(a))[0] || null;
		const state = row ? this._interfaceStatus(row.status, row) : null;
		return {state, recovered: !!state?.class.split(' ').includes('up'), currentDown: !!state && ['down', 'not-present', 'lower-down'].includes(state.class)};
	}

	_problemBuckets(host) {
		const data = this._data(host);
		if (data._buckets) return data._buckets;
		const active = [], recovered = [];
		(host.problems || []).forEach(problem => (this._problemState(problem, data).recovered ? recovered : active).push(problem));
		data._buckets = {active, recovered};
		return data._buckets;
	}

	_maxSeverity(problems) {
		return problems.reduce((max, problem) => Math.max(max, problem.severity), 0);
	}

	// Estado general del firewall: mantenimiento, disponibilidad y severidad de los problemas.
	_hostHealth(host) {
		const data = this._data(host);
		if (data._health) return data._health;
		const active = this._problemBuckets(host).active;
		const max = active.length ? this._maxSeverity(active) : -1;
		const s = data.summary;
		const collectorDown = s.collectors.length > 0 && s.collectors.every(c => this._num(c.item) !== 1);
		let level = 'ok', label = 'Normal';
		if (host.maintenance) [level, label] = ['maintenance', 'Mantenimiento'];
		else if (!host.enabled) [level, label] = ['nodata', 'Deshabilitado'];
		else if (s.ping === 0) [level, label] = ['crit', 'No disponible'];
		else if (max >= 4) [level, label] = ['crit', 'Crítico'];
		else if (max >= 2) [level, label] = ['warn', 'Advertencia'];
		else if (collectorDown) [level, label] = ['nodata', 'Sin datos de monitoreo'];
		data._health = {level, label: this._t(label)};
		return data._health;
	}

	/* ------------------------------------------------------------------ modelo de datos */

	_data(host) {
		let data = this._cache.get(host.hostid);
		if (!data) {
			data = this._prepare(host);
			this._cache.set(host.hostid, data);
		}
		return data;
	}

	// Parámetro de la clave del ítem (contenido entre corchetes, sin comillas).
	_keyArg(key) {
		const match = key.match(/\[(.*)\]$/);
		return match ? match[1].replace(/^"(.*)"$/, '$1') : null;
	}

	// Índice SNMP: elimina el nombre del OID (por ejemplo "ifHCInOctets.12" → "12").
	_snmpIndex(arg) {
		return String(arg).replace(/^[A-Za-z][A-Za-z0-9]*\./, '');
	}

	// Agrupa los ítems del host en entidades (interfaces, SD-WAN, VPN, HA, licencias, políticas…).
	_prepare(host) {
		const settings = this._payload.settings;
		const d = {hostid: host.hostid, interfaces: [], all_interfaces: [], hidden_interfaces: 0, grouped_interfaces: 0, sdwan: [],
			sdwan_members: [], vpns: [], ha: [], sensors: [], vdom: [], security: [], cpu_cores: [], soc: [], licenses: [],
			policies: [], aps: [], data_errors: [], unsupported: [], items_total: 0};
		const exact = {};
		const g = {interfaces: {}, sdwan: {}, members: {}, ha: {}, sensors: {}, vdom: {}, cores: {}, soc: {}, licenses: {}, policies: {}, aps: {}, vpns: {}};
		const W = WidgetLakaFortiGateOverview;
		const items = host.items || [];
		let hasHttp = false, hasSnmp = false;

		items.forEach(item => {
			const key = item.key_;
			exact[key] = item;
			d.items_total++;
			if (key.startsWith('fgate.')) hasHttp = true;
			else if (key.includes('[fg') || key === 'zabbix[host,snmp,available]') hasSnmp = true;
			// Los ítems no soportados sólo se informan en calidad de datos; no deben crear entidades fantasma.
			if (item.state === 1) { d.unsupported.push(item); return; }

			if (/^fgate\.[a-z_]+\.data_errors$/.test(key)) {
				if (String(item.lastvalue || '').trim() !== '') d.data_errors.push(item);
				return;
			}

			const arg = this._keyArg(key);
			if (arg === null) return;

			if (key.startsWith('net.if.') || key.startsWith('fgate.netif.')) {
				const http = key.startsWith('fgate.');
				const id = `${http ? 'h' : 's'}:${http ? arg : this._snmpIndex(arg)}`;
				const row = g.interfaces[id] ||= {id, name: this._t('Interfaz {0}', http ? arg : this._snmpIndex(arg)), alias: ''};
				const identity = this._interfaceIdentity(item.name);
				if (identity.name) { row.name = identity.name; row.alias = identity.alias; }
				const field = {
					'net.if.status[': 'status', 'fgate.netif.status[': 'status', 'net.if.adminstatus[': 'admin_status',
					'net.if.speed[': 'speed', 'fgate.netif.speed[': 'speed', 'net.if.in.errors[': 'in_errors', 'fgate.netif.in_errors[': 'in_errors',
					'net.if.out.errors[': 'out_errors', 'fgate.netif.out_errors[': 'out_errors', 'net.if.in.discards[': 'in_discards',
					'net.if.out.discards[': 'out_discards', 'net.if.type[': 'type', 'fgate.netif.type[': 'type', 'net.if.in[': 'in',
					'fgate.netif.in[': 'in', 'net.if.out[': 'out', 'fgate.netif.out[': 'out', 'fgate.netif.in_packets[': 'in_packets',
					'fgate.netif.out_packets[': 'out_packets'
				}[key.slice(0, key.indexOf('[') + 1)];
				if (field) { row[field] = item; row.http = http; }
			}
			else if (key.startsWith('sdwan_health.') || key.startsWith('fgate.sdwan_health.')) {
				const id = key.startsWith('fgate.') ? `h:${arg}` : `s:${this._snmpIndex(arg)}`;
				const identity = this._bracketPair(item.name, 'SD-WAN');
				const row = g.sdwan[id] ||= {id, health: identity[0] || `Health-check ${id}`, interface: identity[1] || this._t('Miembro {0}', id)};
				const field = key.match(/\.(state|status|latency|jitter|loss|sent|received)\[/)?.[1];
				if (field) row[field === 'status' ? 'state' : field] = item;
			}
			else if (key.startsWith('fgate.sdwan_member.') || key.startsWith('fgate.service.state_changed[')) {
				// fgate.service.state_changed[] pertenece a los miembros SD-WAN aunque su clave diga "service".
				const identity = this._bracketPair(item.name, 'SD-WAN');
				const row = g.members[arg] ||= {id: arg, zone: identity[0] || '', name: identity[1] || this._t('Miembro {0}', arg)};
				const field = key.startsWith('fgate.service.state_changed[') ? 'state_changed' : key.slice(19, key.indexOf('['));
				row[field] = item;
			}
			else if (key.startsWith('fgate.service.')) {
				const row = g.licenses[arg] ||= {key: arg, name: (item.name.match(/^Service\s+\[(.+?)\]:/) || [null, arg])[1]};
				row[key.slice(14, key.indexOf('['))] = item;
			}
			else if (key.startsWith('fgate.fwp.')) {
				const row = g.policies[arg] ||= {uuid: arg, name: (item.name.match(/^FW Policy\s+\[(.+?)\]:/) || [null, arg])[1]};
				row[key.slice(10, key.indexOf('['))] = item;
			}
			else if (key.startsWith('vpn.tunnel.status[')) {
				g.vpns[item.itemid] = {name: (item.name.match(/^VPN\s+(.+?):/) || [null, item.name])[1], status: item};
			}
			else if (W.HA_MEMBER_KEYS.some(prefix => key.startsWith(prefix))) {
				// Sólo los ítems por miembro; los escalares ha.*[...0] no crean miembros.
				const id = this._snmpIndex(arg);
				const row = g.ha[id] ||= {id};
				const field = {'ha.serialnumber[': 'serial', 'ha.hostname[': 'hostname', 'ha.cpu.usage[': 'cpu', 'ha.mem.usage[': 'memory',
					'ha.net.usage[': 'network', 'ha.session.count[': 'sessions', 'ha.packets.rate[': 'packets', 'ha.ips.events[': 'ips',
					'ha.sync.status[': 'sync', 'ha.av.events[': 'av', 'ha.bytes.rate[': 'bytes', 'ha.checksum.global[': 'checksum',
					'ha.primary.serialnumber[': 'primary'}[key.slice(0, key.indexOf('[') + 1)];
				if (field) row[field] = item;
			}
			else if (key.startsWith('hw.sensor.')) {
				const id = this._snmpIndex(arg);
				const row = g.sensors[id] ||= {id, name: (item.name.match(/^Sensor\s+(.+?):/) || [null, `Sensor ${id}`])[1]};
				if (key.startsWith('hw.sensor.value[')) row.value = item; else if (key.startsWith('hw.sensor.status[')) row.status = item;
			}
			else if (key.startsWith('vdom.')) {
				const id = this._snmpIndex(arg);
				const row = g.vdom[id] ||= {id, name: (item.name.match(/^VDOM\s+(.+?):/) || [null, `VDOM ${id}`])[1]};
				const field = {'vdom.op_mode[': 'mode', 'vdom.ha.state[': 'ha', 'vdom.cpu.usage[': 'cpu', 'vdom.mem.usage[': 'memory',
					'vdom.sessions.rate[': 'rate', 'vdom.sessions[': 'sessions'}[key.slice(0, key.indexOf('[') + 1)];
				if (field) row[field] = item;
			}
			else if (key.startsWith('system.cpu.usage[')) {
				const id = this._snmpIndex(arg);
				const row = g.cores[id] ||= {id, label: `Core ${(item.name.match(/^CPU Core\s+(.+?):/) || [null, id])[1]}`};
				if (arg.startsWith('fgProcessorSysUsage')) row.sys = item;
				else if (arg.startsWith('fgProcessorUserUsage')) row.user = item;
				else row.usage = item;
			}
			else if (key.startsWith('soc3.')) {
				const id = this._snmpIndex(arg);
				const row = g.soc[id] ||= {id};
				const field = key.match(/\.pkt\.(dropped|received|transmitted)\[/)?.[1];
				if (field) row[field] = item;
			}
			else if (key.startsWith('wc.')) {
				// Los ítems de radio usan otro índice SNMP; se agrupan por el nombre del WTP.
				const name = (item.name.match(/^WTP\s+(.+?):\s/) || [null, this._snmpIndex(arg)])[1];
				const row = g.aps[name] ||= {name};
				row[key.slice(3, key.indexOf('['))] = item;
			}
			else if (key.startsWith('ips.') && !key.startsWith('ips.database.version')) {
				d.security.push(item);
			}
		});

		const pick = (...keys) => keys.map(key => exact[key]).find(Boolean) || null;
		const val = item => item ? item.lastvalue : null;
		Object.assign(d, {
			source: hasHttp && hasSnmp ? 'HTTP + SNMP' : hasHttp ? 'HTTP API' : 'SNMP',
			model: val(pick('system.hw.model', 'fgate.device.model')),
			firmware: val(pick('system.hw.firmware', 'fgate.device.firmware')),
			serial: val(pick('system.hw.serialnumber', 'fgate.device.serialnumber')),
			sysname: pick('system.name', 'fgate.name'),
			descr: pick('system.descr[sysDescr.0]'),
			location: val(pick('system.location[sysLocation.0]')),
			contact: pick('system.contact[sysContact.0]'),
			objectid: pick('system.objectid[sysObjectID.0]'),
			uptime: pick('system.uptime[fgSysUpTime.0]', 'fgate.uptime'),
			cpu: pick('system.cpu.util[fgSysCpuUsage.0]', 'fgate.cpu.util'),
			cpu_num: pick('system.cpu.num', 'fgate.cpu.num'),
			memory_total: pick('vm.memory.total[fgSysMemCapacity.0]', 'fgate.memory.total'),
			memory_util: pick('vm.memory.util[memoryUsedPercentage.0]', 'fgate.memory.util'),
			memory_used: pick('vm.memory.used[fgSysMemUsage.0]'),
			memory_available: pick('vm.memory.available[fgSysMemFree.0]'),
			disk_free_pct: pick('vfs.fs.pfree'),
			disk_util: pick('fgate.fs.util'),
			disk_free: pick('vfs.fs.free', 'fgate.fs.free'),
			disk_total: pick('vfs.fs.total[fgSysDiskCapacity.0]', 'fgate.fs.total'),
			disk_used: pick('vfs.fs.used[fgSysDiskUsage.0]', 'fgate.fs.used'),
			sessions: pick('net.ipv4.sessions[fgSysSesCount.0]'),
			ping: pick('icmpping'),
			ping_loss: pick('icmppingloss'),
			ping_rtt: pick('icmppingsec'),
			collector_snmp: pick('zabbix[host,snmp,available]'),
			collector_api: pick('fgate.api.status'),
			api_port: items.find(item => item.key_.startsWith('net.tcp.service[')) || null,
			vpn_active: pick('vpn.tunnel.active[fgVpnTunnelUpCount.0]'),
			vpn_users: pick('vpn.users.count[fgVpnSslStatsLoginUsers.0]'),
			vpn_ssl_state: pick('vpn.ssl.state[fgVpnSslState.0]'),
			ha_mode: pick('ha.mode[fgHaSystemMode.0]'),
			ha_group_name: pick('ha.cluster.group_name[fgHaGroupName.0]'),
			ha_group_id: pick('ha.cluster.group_id[fgHaGroupId.0]'),
			ha_auto_sync: pick('ha.auto.sync[fgHaAutoSync.0]'),
			ha_override: pick('ha.cluster.override[fgHaOverride.0]'),
			ha_priority: pick('ha.cluster.priority[fgHaPriority.0]'),
			ha_schedule: pick('ha.schedule[fgHaSchedule.0]'),
			ips_db: pick('ips.database.version[fgSysVersionIps.0]'),
			firmware_avail: pick('fgate.device.firmwares_avail'),
			vdom_current: pick('fgate.device.vdom')
		});

		// Interfaces: función WAN/SD-WAN, tipo y DOWN esperado.
		const wanRegex = this._regex(settings.wan_regex, /(wan|internet|isp|outside|uplink|broadband|sdwan)/i);
		const expectedDownRegex = this._regex(settings.expected_down_regex, /(?!)/);
		const manualWan = this._hostWanSet(host.hostid);
		d.sdwan = Object.values(g.sdwan);
		d.sdwan_members = Object.values(g.members);
		const sdwanNames = new Set([...d.sdwan.map(row => row.interface), ...d.sdwan_members.map(row => row.name)]
			.map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
		d.all_interfaces = Object.values(g.interfaces).map(row => {
			const identity = `${row.name} ${row.alias}`.trim();
			const isManualWan = manualWan.has(String(row.name).trim().toLowerCase());
			const kind = this._ifKind(row);
			return {...row, kind,
				is_wan: isManualWan || (settings.wan_regex !== '' && wanRegex.test(identity)),
				is_wan_manual: isManualWan,
				is_sdwan: sdwanNames.has(String(row.name).trim().toLowerCase()),
				is_physical: kind === 'physical',
				is_vlan: kind === 'vlan' || /\bvlan\s*\d*/i.test(identity),
				expected_down: settings.expected_down_regex !== '' && expectedDownRegex.test(identity)
			};
		});
		const filtered = this._filterInterfaces(d.all_interfaces, host.hostid);
		d.hidden_interfaces = d.all_interfaces.length - filtered.length;
		d.interfaces = this._interfacePreferences(host.hostid).deduplicate ? this._deduplicateInterfaces(filtered) : filtered;
		d.grouped_interfaces = filtered.length - d.interfaces.length;

		d.vpns = Object.values(g.vpns).sort((a, b) => (this._num(a.status) === 2) - (this._num(b.status) === 2) || this._naturalCompare(a.name, b.name));
		d.ha = Object.values(g.ha).sort((a, b) => this._naturalCompare(a.id, b.id));
		d.sensors = Object.values(g.sensors);
		d.vdom = Object.values(g.vdom);
		d.cpu_cores = Object.values(g.cores).sort((a, b) => this._naturalCompare(a.id, b.id));
		d.soc = Object.values(g.soc);
		d.licenses = Object.values(g.licenses);
		d.policies = Object.values(g.policies);
		d.aps = Object.values(g.aps);
		d.unsupported_count = Math.max(Number(host.unsupported) || 0, d.unsupported.length);
		d.detail = !!host.detail;
		d.summary = this._summarize(d, settings);
		return d;
	}

	// Indicadores resumidos usados por la flota, la barra lateral y las verificaciones de salud.
	_summarize(d, settings) {
		const s = {};
		s.cpu = this._num(d.cpu);
		s.memory = this._num(d.memory_util);
		const free = this._num(d.disk_free_pct), total = this._num(d.disk_total), used = this._num(d.disk_used);
		s.disk_used = this._num(d.disk_util) ?? (free !== null ? 100 - free : total && used !== null ? used / total * 100 : null);
		s.sessions = this._num(d.sessions) ?? (d.sdwan_members.some(m => m.sessions) ? d.sdwan_members.reduce((sum, m) => sum + (this._num(m.sessions) || 0), 0) : null);
		s.ping = this._num(d.ping);
		s.loss = this._num(d.ping_loss);
		s.rtt = this._num(d.ping_rtt) === null ? null : this._num(d.ping_rtt) * 1000;
		s.api_port = this._num(d.api_port);
		s.collectors = [d.collector_api ? {label: 'API HTTP', item: d.collector_api} : null, d.collector_snmp ? {label: 'SNMP', item: d.collector_snmp} : null].filter(Boolean);

		const coreValues = d.cpu_cores.map(core => this._num(core.usage)).filter(v => v !== null);
		s.cpu_cores = d.cpu_cores.length;
		s.cpu_core_max = coreValues.length ? Math.max(...coreValues) : null;

		const wan = d.all_interfaces.filter(row => row.is_wan);
		s.wan_total = wan.length;
		s.wan_up = wan.filter(row => this._interfaceStatus(row.status, row).class.split(' ')[0] === 'up' || row.expected_down).length;

		s.sla_total = d.sdwan.length;
		s.sla_dead = d.sdwan.filter(row => ['dead', 'error'].includes(this._sdwanState(row.state))).length;
		s.sla_bad = d.sdwan.filter(row => ['warn', 'crit'].includes(this._slaLevel(row, settings))).length;

		s.vpn_total = d.vpns.length;
		s.vpn_up = d.vpns.filter(row => this._num(row.status) === 2).length;

		// Alta disponibilidad: sincronización y checksum de configuración entre miembros.
		s.ha_mode_value = this._num(d.ha_mode);
		const primary = d.ha.map(row => row.primary?.lastvalue).find(Boolean) || null;
		s.ha_primary_serial = primary;
		if (s.ha_mode_value === 2 || s.ha_mode_value === 3) {
			const unsynced = d.ha.filter(row => row.sync && this._num(row.sync) !== 1).length;
			const checksums = new Set(d.ha.map(row => row.checksum?.lastvalue).filter(Boolean));
			const modeLabel = s.ha_mode_value === 2 ? 'A-A' : 'A-P';
			if (d.ha.length && d.ha.length < 2) {
				s.ha_level = 'crit'; s.ha_label = `${modeLabel} · ${this._t('1 miembro')}`; s.ha_detail = this._t('El clúster sólo reporta un miembro');
			}
			else if (unsynced || checksums.size > 1) {
				s.ha_level = 'crit'; s.ha_label = `${modeLabel} · ${this._t('sin sincronizar')}`;
				s.ha_detail = this._t('{0} miembros sin sincronizar', unsynced) + (checksums.size > 1 ? ` · ${this._t('checksum distinto')}` : '');
			}
			else {
				s.ha_level = 'ok'; s.ha_label = `${modeLabel} · ${this._t('{0} miembros', d.ha.length || '?')}`; s.ha_detail = this._t('Miembros sincronizados');
			}
		}
		else {
			s.ha_level = 'ok';
			s.ha_label = s.ha_mode_value === 1 ? 'Standalone' : '—';
			s.ha_detail = '';
		}

		const licenses = d.licenses.map(row => this._licenseInfo(row, settings)).filter(info => info.code !== null || info.expire);
		s.license_total = licenses.length;
		s.license_expired = licenses.filter(info => info.level === 'crit').length;
		s.license_soon = licenses.filter(info => info.level === 'warn').length;
		const days = licenses.map(info => info.days).filter(v => v !== null && v >= 0);
		s.license_days = days.length ? Math.min(...days) : null;
		s.license_level = s.license_expired ? 'crit' : s.license_soon ? 'warn' : licenses.length ? 'ok' : 'nodata';
		s.license_days_level = s.license_days === null ? 'nodata' : s.license_days < Number(settings.license_crit_days) ? 'crit'
			: s.license_days < Number(settings.license_warn_days) ? 'warn' : 'ok';

		s.firmware_update = (this._num(d.firmware_avail) || 0) > 0;
		s.sensor_alarms = d.sensors.filter(row => this._num(row.status) === 1).length;
		s.ap_total = d.aps.length;
		s.ap_online = d.aps.filter(row => this._apState(row).online).length;
		s.wifi_clients = d.aps.reduce((sum, row) => sum + (this._num(row['clients.num']) || 0), 0);

		const now = Date.now() / 1000, unused = Math.max(1, Number(settings.policy_unused_days) || 90) * 86400;
		s.policies_total = d.policies.length;
		s.policies_unused = d.policies.filter(row => this._num(row.status) !== 1 && (!this._num(row.last_used) || now - this._num(row.last_used) > unused)).length;
		return s;
	}

	_bracketPair(name, prefix) {
		const match = String(name || '').match(new RegExp(`^${prefix}\\s+\\[([^\\]]+)\\]:\\[([^\\]]+)\\]:`));
		return match ? [match[1], match[2]] : [];
	}

	_ifKind(row) {
		const value = this._num(row.type);
		if (value !== null) {
			const map = row.http ? WidgetLakaFortiGateOverview.IF_KIND_HTTP : WidgetLakaFortiGateOverview.IF_KIND_SNMP;
			if (map[value]) return map[value];
		}
		// Sin ítem de tipo: se deduce por el nombre del puerto.
		if (/^(port|wan|lan|dmz|x|mgmt|ha|internal|a|b|s)\d+$/i.test(row.name) || /^(wan|lan|dmz|mgmt|internal)$/i.test(row.name)) return 'physical';
		if (/vlan/i.test(`${row.name} ${row.alias}`)) return 'vlan';
		if (/^(ssl\.|.*tunnel|.*ipsec)/i.test(row.name)) return 'tunnel';
		return 'other';
	}

	_ifKindLabel(kind) {
		const labels = {physical: 'Puerto físico', vlan: 'VLAN', aggregate: 'Agregada', tunnel: 'Túnel', loopback: 'Loopback', switch: 'Switch virtual'};
		return this._t(labels[kind] || 'Interfaz lógica');
	}

	_ifErrors(row) {
		return (this._num(row.in_errors) || 0) + (this._num(row.out_errors) || 0);
	}

	/* ------------------------------------------------------------------ preferencias por firewall (guardadas en el navegador) */

	_regex(value, fallback) {
		if (value === null || value === undefined || String(value) === '') return fallback;
		try { return new RegExp(value, 'i'); } catch (_) { return fallback; }
	}
	_nameSet(value) { return new Set(String(value || '').split(/[,;\n]+/).map(name => name.trim().toLowerCase()).filter(Boolean)); }
	_storageScope() {
		const node = this._body?.closest?.('.dashboard-grid-widget,[data-widgetid],[data-widget-id],[data-uniqueid]');
		return String(this._widgetid || node?.dataset?.widgetid || node?.dataset?.widgetId || node?.dataset?.uniqueid || node?.id || this._body?.id || 'default');
	}
	_hostWanKey(hostid) { return `laka.fortigate.wan.v1:${location.pathname}:${this._storageScope()}:${hostid}`; }
	_hostWanSet(hostid) {
		try { const value = JSON.parse(localStorage.getItem(this._hostWanKey(hostid)) || '[]'); return this._nameSet(Array.isArray(value) ? value.join(',') : ''); }
		catch (_) { return new Set(); }
	}
	_saveHostWanSet(hostid, value) {
		try { localStorage.setItem(this._hostWanKey(hostid), JSON.stringify([...this._nameSet(value)])); }
		catch (_) { return false; }
		this._cache.delete(hostid);
		return true;
	}
	_clearHostWanSet(hostid) {
		try { localStorage.removeItem(this._hostWanKey(hostid)); } catch (_) { return false; }
		this._cache.delete(hostid);
		return true;
	}
	_bindWanEditor(container, host) {
		const editor = container.querySelector('.fg-wan-editor'), toggle = container.querySelector('[data-wan-editor-toggle]');
		if (!editor || !toggle) return;
		const input = editor.querySelector('[data-wan-editor-input]');
		toggle.addEventListener('click', () => { editor.hidden = !editor.hidden; if (!editor.hidden) { input.focus(); input.select(); } });
		editor.querySelector('[data-wan-editor-cancel]').addEventListener('click', () => { editor.hidden = true; });
		editor.querySelector('[data-wan-editor-save]').addEventListener('click', () => { if (this._saveHostWanSet(host.hostid, input.value)) this._renderWidget(); });
		editor.querySelector('[data-wan-editor-clear]').addEventListener('click', () => { if (this._clearHostWanSet(host.hostid)) this._renderWidget(); });
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') { event.preventDefault(); editor.querySelector('[data-wan-editor-save]').click(); }
			if (event.key === 'Escape') editor.hidden = true;
		});
	}
	_interfacePreferenceKey(hostid) { return `laka.fortigate.interfaces.v1:${location.pathname}:${this._storageScope()}:${hostid}`; }
	_interfacePreferenceDefaults() { return {hide_vlan: true, hide_logical: false, hide_down_idle: false, deduplicate: true, exclude_regex: ''}; }
	_interfacePreferences(hostid) {
		const defaults = this._interfacePreferenceDefaults();
		try { const saved = JSON.parse(localStorage.getItem(this._interfacePreferenceKey(hostid)) || '{}'); return {...defaults, ...(saved && typeof saved === 'object' ? saved : {})}; }
		catch (_) { return defaults; }
	}
	_saveInterfacePreferences(hostid, preferences) {
		try { localStorage.setItem(this._interfacePreferenceKey(hostid), JSON.stringify({...this._interfacePreferenceDefaults(), ...preferences})); }
		catch (_) { return false; }
		this._cache.delete(hostid);
		return true;
	}
	_filterInterfaces(rows, hostid) {
		const preferences = this._interfacePreferences(hostid);
		let exclude = null;
		if (preferences.exclude_regex) { try { exclude = new RegExp(preferences.exclude_regex, 'i'); } catch (_) { exclude = null; } }
		return rows.filter(row => {
			const identity = `${row.name || ''} ${row.alias || ''}`.trim();
			if (exclude?.test(identity)) return false;
			if (preferences.hide_vlan && !row.is_wan_manual && row.is_vlan) return false;
			if (preferences.hide_logical && !row.is_physical && !row.is_wan && !row.is_sdwan) return false;
			if (preferences.hide_down_idle && !row.is_wan && !row.is_sdwan) {
				const state = this._interfaceStatus(row.status, row).class.split(' ')[0];
				const traffic = Math.max(this._num(row.in) || 0, this._num(row.out) || 0);
				if (state !== 'up' && traffic <= 0) return false;
			}
			return true;
		});
	}
	// Puntaje para elegir la lectura más útil cuando hay interfaces repetidas por nombre.
	_interfaceScore(row) {
		const state = this._interfaceStatus(row.status, row).class.split(' ')[0];
		const traffic = Math.max(this._num(row.in) || 0, this._num(row.out) || 0);
		const lastclock = Math.max(Number(row.status?.lastclock || 0), Number(row.in?.lastclock || 0), Number(row.out?.lastclock || 0));
		return (state === 'up' ? 1e15 : 0) + (traffic > 0 ? 1e14 : 0) + (row.is_wan ? 1e13 : 0) + (row.is_sdwan ? 1e12 : 0) + Math.min(traffic, 1e11) + lastclock;
	}
	_deduplicateInterfaces(rows) {
		const groups = new Map();
		rows.forEach(row => { const key = String(row.name || row.id).trim().toLowerCase(); const group = groups.get(key) || []; group.push(row); groups.set(key, group); });
		return [...groups.values()].map(group => ({...[...group].sort((a, b) => this._interfaceScore(b) - this._interfaceScore(a))[0], duplicate_count: group.length}));
	}
	_interfaceEditor(data) {
		const preferences = this._interfacePreferences(data.hostid);
		const checked = value => value ? ' checked' : '';
		const option = (name, label) => `<label><input type="checkbox" data-interface-option="${name}"${checked(preferences[name])}> ${this._e(this._t(label))}</label>`;
		const summary = [this._t('{0} detectadas', data.all_interfaces.length), this._t('{0} visibles', data.interfaces.length)];
		if (data.hidden_interfaces) summary.push(this._t('{0} ocultas', data.hidden_interfaces));
		if (data.grouped_interfaces) summary.push(this._t('{0} repetidas agrupadas', data.grouped_interfaces));
		return `<div class="fg-interface-editor" hidden>
			<div class="fg-interface-options">
				${option('hide_vlan', 'Ocultar VLAN')}${option('hide_logical', 'Ocultar lógicas y túneles')}${option('hide_down_idle', 'Ocultar DOWN sin tráfico')}${option('deduplicate', 'Agrupar nombres repetidos')}
			</div>
			<label class="fg-interface-regex">${this._e(this._t('Excluir por nombre o alias (expresión regular)'))}<input type="text" data-interface-exclude value="${this._e(preferences.exclude_regex)}" placeholder="^(Vlan|ssl\\.|loopback|tunnel)"></label>
			<small>${this._e(summary.join(' · '))}. ${this._e(this._t('La configuración pertenece sólo a este FortiGate y navegador.'))}</small>
			<p class="fg-interface-error" hidden></p>
			<div class="fg-interface-editor-actions"><button data-interface-save>${this._e(this._t('Guardar'))}</button><button data-interface-reset>${this._e(this._t('Restablecer'))}</button><button data-interface-cancel>${this._e(this._t('Cancelar'))}</button></div>
		</div>`;
	}
	_bindInterfaceEditor(container, host) {
		container.querySelectorAll('.fg-interface-editor').forEach(editor => {
			const toggle = editor.closest('.fg-panel')?.querySelector('[data-interface-editor-toggle]');
			if (!toggle) return;
			const regex = editor.querySelector('[data-interface-exclude]'), error = editor.querySelector('.fg-interface-error');
			toggle.addEventListener('click', () => { editor.hidden = !editor.hidden; if (!editor.hidden) regex.focus(); });
			editor.querySelector('[data-interface-cancel]').addEventListener('click', () => { editor.hidden = true; });
			editor.querySelector('[data-interface-save]').addEventListener('click', () => {
				const value = regex.value.trim();
				if (value) {
					try { new RegExp(value, 'i'); }
					catch (exception) { error.textContent = this._t('Expresión no válida: {0}', exception.message); error.hidden = false; return; }
				}
				const preferences = {exclude_regex: value};
				editor.querySelectorAll('[data-interface-option]').forEach(input => { preferences[input.dataset.interfaceOption] = input.checked; });
				if (this._saveInterfacePreferences(host.hostid, preferences)) this._renderWidget();
			});
			editor.querySelector('[data-interface-reset]').addEventListener('click', () => {
				try { localStorage.removeItem(this._interfacePreferenceKey(host.hostid)); this._cache.delete(host.hostid); this._renderWidget(); }
				catch (_) { error.textContent = this._t('No fue posible restablecer la configuración local.'); error.hidden = false; }
			});
			regex.addEventListener('keydown', event => {
				if (event.key === 'Enter') { event.preventDefault(); editor.querySelector('[data-interface-save]').click(); }
				if (event.key === 'Escape') editor.hidden = true;
			});
		});
	}

	/* ------------------------------------------------------------------ utilidades de valores */

	// Nombre y alias desde el nombre del ítem: "Interface port1(WAN)" (SNMP) o "Interface [port1(WAN)]" (HTTP).
	_interfaceIdentity(name) {
		const m = String(name).match(/^Interface\s+\[?(.+?)\((.*?)\)\]?:/);
		if (m) return {name: m[1], alias: m[2]};
		const simple = String(name).match(/^Interface\s+\[?([^:\]]+)\]?:/);
		return simple ? {name: simple[1].trim(), alias: ''} : {name: '', alias: ''};
	}
	// Estado de interfaz: HTTP (0 = down, 1 = up) o SNMP ifOperStatus (1 – 7).
	_interfaceStatus(item, row = null) {
		const v = this._num(item), isHttp = item?.key_?.startsWith('fgate.netif.');
		const admin = this._num(row?.admin_status);
		if (item && isHttp) {
			if (v === 1) return {class: 'up', label: 'UP', detail: this._t('API HTTP · enlace activo')};
			if (v === 0 && row?.expected_down) return {class: 'expected', label: this._t('DOWN esperado'), detail: this._t('Enlace inactivo excluido mediante la expresión de interfaces DOWN esperadas')};
			if (v === 0) return {class: 'down', label: 'DOWN', detail: this._t('API HTTP · enlace inactivo')};
		}
		else if (item) {
			const states = {1: ['up', 'UP', 'enlace activo'], 2: ['down', 'DOWN', 'enlace inactivo'], 3: ['testing', 'TESTING', 'en pruebas'],
				4: ['unknown', 'UNKNOWN', 'estado desconocido'], 5: ['dormant', 'DORMANT', 'esperando un evento externo'],
				6: ['not-present', 'NOT PRESENT', 'componente no presente'], 7: ['lower-down', 'LOWER DOWN', 'capa inferior inactiva']};
			if (states[v]) {
				const [cls, label, text] = states[v];
				if (v !== 1 && row?.expected_down) return {class: 'expected', label: this._t('DOWN esperado'), detail: this._t('SNMP ifOperStatus {0} · excluida mediante configuración', v)};
				return {class: cls, label, detail: `SNMP ifOperStatus ${v} · ${this._t(text)}${admin === 2 ? ` · ${this._t('administrativamente DOWN')}` : ''}`};
			}
		}
		const traffic = Math.max(this._num(row?.in) || 0, this._num(row?.out) || 0);
		if (!item && traffic > 0) return {class: 'up inferred', label: 'UP*', detail: this._t('Estado inferido por tráfico reciente; no existe ítem de estado')};
		return {class: 'unknown', label: 'UNKNOWN', detail: item ? this._t('Valor de estado no reconocido: {0}', item.lastvalue) : this._t('Sin ítem de estado disponible')};
	}
	_sdwanState(item) { const v = this._num(item); return v === 0 ? 'alive' : v === 1 ? 'dead' : v === 2 ? 'error' : 'unknown'; }
	_sdwanLink(item) { const v = this._num(item); return v === 0 ? {cls: 'up', label: 'UP'} : v === 1 ? {cls: 'down', label: 'DOWN'} : v === 2 ? {cls: 'error', label: 'ERROR'} : {cls: 'unknown', label: '—'}; }
	_vpnState(item) { const v = this._num(item); return v === 2 ? 'up' : v === 1 ? 'down' : 'unknown'; }
	// La clase CSS es fija; la etiqueta se traduce.
	_syncState(item) {
		const v = this._num(item);
		if (v === 1) return {cls: 'up', label: this._t('sincronizado')};
		if (v === 0) return {cls: 'down', label: this._t('sin sincronizar')};
		return {cls: 'unknown', label: this._t('desconocido')};
	}
	_haMode(item) { const v = this._num(item); return v === 1 ? 'Standalone' : v === 2 ? this._t('Activo-Activo') : v === 3 ? this._t('Activo-Pasivo') : item?.lastvalue || this._t('Sin datos'); }
	_haSchedule(item) {
		const labels = {1: 'Ninguno', 2: 'Hub', 3: 'Menos conexiones', 4: 'Round robin', 5: 'Round robin ponderado', 6: 'Aleatorio', 7: 'Por IP', 8: 'Por IP y puerto'};
		const label = labels[this._num(item)];
		return label ? this._t(label) : '—';
	}
	_optionState(item) { const v = this._num(item); return v === 2 ? this._t('Habilitado') : v === 1 ? this._t('Deshabilitado') : '—'; }
	_vdomMode(item) { const v = this._num(item); return v === 1 ? 'NAT' : v === 2 ? this._t('Transparente') : item?.lastvalue || '—'; }
	_vdomHa(item) { const v = this._num(item); return v === 1 ? this._t('Primario') : v === 2 ? this._t('Secundario') : v === 3 ? 'Standalone' : '—'; }
	_band(item) { const v = this._num(item); return v === 1 ? '2.4 GHz' : v === 2 ? '5 GHz' : v === 0 ? this._t('Otra') : '—'; }
	_policyAction(item) { const v = this._num(item); return {0: {id: 'accept', label: 'ACCEPT', cls: 'up'}, 1: {id: 'deny', label: 'DENY', cls: 'down'}, 2: {id: 'ipsec', label: 'IPSEC', cls: 'testing'}}[v] || {id: 'unknown', label: '—', cls: 'unknown'}; }
	_securityLabel(key) {
		const labels = {'ips.blocked[': 'Intrusiones bloqueadas', 'ips.detected.total[': 'Detecciones totales', 'ips.detected.crit[': 'Críticas',
			'ips.detected.high[': 'Altas', 'ips.detected.med[': 'Medias', 'ips.detected.low[': 'Bajas', 'ips.detected.info[': 'Informativas',
			'ips.detected.anomaly[': 'Anomalías', 'ips.detected.sign[': 'Firmas'};
		const label = labels[key.slice(0, key.indexOf('[') + 1)];
		return label ? this._t(label) : key;
	}
	_hostAddress(host) {
		const meta = host.interfaces_meta || [];
		const address = meta.find(row => String(row.main) === '1' && String(row.type) === '2') || meta.find(row => String(row.main) === '1') || meta[0];
		return address ? (String(address.useip) === '0' ? address.dns : address.ip) || address.ip || address.dns || '' : '';
	}
	_bpsFromBytes(item) { const v = this._num(item); return v === null ? null : v * 8; }
	_num(item) { if (!item || item.lastvalue === '' || item.lastvalue === null || item.lastvalue === undefined || Number.isNaN(Number(item.lastvalue))) return null; return Number(item.lastvalue); }
	_value(item, unit = '') { const value = this._num(item); return value === null ? '—' : `${this._fmt(value)}${unit}`; }
	_fmt(value) { return new Intl.NumberFormat(this._locale(), {maximumFractionDigits: 1}).format(value); }
	_rate(value) { if (value === null || value === undefined) return '—'; if (value === 0) return '0'; const abs = Math.abs(value); return abs < 10 ? new Intl.NumberFormat(this._locale(), {maximumFractionDigits: abs < 1 ? 3 : 2}).format(value) : this._compact(value); }
	_compact(value) { return value === null || value === undefined || Number.isNaN(value) ? '—' : new Intl.NumberFormat(this._locale(), {notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1}).format(value); }
	_bytes(value) { if (value === null || value === undefined) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (Math.abs(value) >= 1024 && i < u.length - 1) { value /= 1024; i++; } return `${this._fmt(value)} ${u[i]}`; }
	_bits(value) { if (value === null || value === undefined) return '—'; const u = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']; let i = 0; while (Math.abs(value) >= 1000 && i < u.length - 1) { value /= 1000; i++; } return `${this._fmt(value)} ${u[i]}`; }
	_levelHigh(value, warn, crit) { return value === null || value === undefined ? 'nodata' : value >= Number(crit) ? 'crit' : value >= Number(warn) ? 'warn' : 'ok'; }
	_worst(levels) { return levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : levels.includes('ok') ? 'ok' : 'nodata'; }
	_uptime(seconds, short = false) {
		if (seconds === null || seconds === undefined) return '—';
		const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
		return short ? (d ? `${d}d ${h}h` : `${h}h ${m}m`) : `${d}d ${h}h ${m}m`;
	}
	_itemAge(item) { return item?.lastclock ? this._age(item.lastclock) : this._t('Sin datos'); }
	_age(clock) {
		const s = Math.max(0, Math.floor(Date.now() / 1000 - clock));
		const short = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
		return this._t('hace {0}', short);
	}
	_duration(clock) { const s = Math.max(0, Math.floor(Date.now() / 1000 - clock)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; }
	_date(clock) { return new Date(clock * 1000).toLocaleDateString(this._locale(), {year: 'numeric', month: 'short', day: '2-digit'}); }
	_sensorNumber(value) { const m = String(value ?? '').match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null; }
	_naturalCompare(a, b) { return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'}); }
	_fact(label, value, level) { return `<div><span>${this._e(label)}</span><strong class="${level}" title="${this._e(value)}">${this._e(value)}</strong></div>`; }
	_empty(title, text) { return `<div class="fg-empty small"><strong>${this._e(title)}</strong><span>${this._e(text)}</span></div>`; }
	_e(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[c])); }

	// Tabla ordenable genérica; los valores nulos siempre quedan al final.
	_table(id, columns, rows, options = {}) {
		const state = this._tableState[id] || {key: options.sort || columns[0].id, dir: options.dir || columns.find(c => c.id === (options.sort || columns[0].id))?.dir || 1};
		this._tableState[id] = state;
		const column = columns.find(c => c.id === state.key) || columns[0];
		const sorted = [...rows].sort((a, b) => {
			const va = column.sort ? column.sort(a) : null, vb = column.sort ? column.sort(b) : null;
			const na = va === null || va === undefined || (typeof va === 'number' && Number.isNaN(va));
			const nb = vb === null || vb === undefined || (typeof vb === 'number' && Number.isNaN(vb));
			if (na && nb) return 0;
			if (na) return 1;
			if (nb) return -1;
			const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : this._naturalCompare(va, vb);
			return cmp * state.dir;
		});
		return `<div class="fg-table-wrap"><table class="fg-table" data-table="${id}"><thead><tr>${columns.map(c => `<th ${c.sort ? `data-sort="${c.id}" data-dir="${c.dir || 1}" class="is-sortable ${state.key === c.id ? 'is-sorted' : ''}"` : ''}>${this._e(c.label)}${state.key === c.id ? `<i>${state.dir > 0 ? '▲' : '▼'}</i>` : ''}</th>`).join('')}</tr></thead><tbody>${sorted.map(row => `<tr ${options.rowAttrs ? options.rowAttrs(row) : ''}>${columns.map(c => `<td class="${c.cls || ''}">${c.render(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
	}

	/* ------------------------------------------------------------------ histórico bajo demanda */

	_historyStore(hours) {
		return this._hist[hours] ||= {};
	}

	// Solicita el histórico a laka.fortigate.history (máx. 60 ítems por petición, caché de 55 s).
	_loadHistory(itemids, hours) {
		const store = this._historyStore(hours), now = Date.now();
		const missing = [...new Set(itemids)].filter(id => id && (!store[id] || now - store[id].t > 55000));
		if (!missing.length) return Promise.resolve(store);

		const chunks = [];
		for (let i = 0; i < missing.length; i += 60) chunks.push(missing.slice(i, i + 60));
		return Promise.all(chunks.map(chunk => {
			const key = `${hours}:${chunk.join(',')}`;
			if (this._histPending.has(key)) return this._histPending.get(key);
			const body = new URLSearchParams();
			chunk.forEach(id => body.append('itemids[]', id));
			body.append('hours', String(hours));
			const request = fetch(WidgetLakaFortiGateOverview.HISTORY_ACTION, {method: 'POST', body, credentials: 'same-origin'})
				.then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
				.then(json => {
					if (!json || typeof json !== 'object' || json.error || !json.history) throw new Error(json?.error || this._t('Respuesta no válida'));
					const t = Date.now();
					chunk.forEach(id => { store[id] = {t, points: Array.isArray(json.history[id]) ? json.history[id] : []}; });
				})
				.catch(error => {
					// Se reintenta antes que una respuesta correcta (15 s en lugar de 55 s).
					const t = Date.now();
					chunk.forEach(id => { store[id] = {t: t - 40000, points: store[id]?.points || [], error: String(error.message || error)}; });
				})
				.finally(() => this._histPending.delete(key));
			this._histPending.set(key, request);
			return request;
		})).then(() => store);
	}

	_drawAllCharts() {
		const canvases = [...this._body.querySelectorAll('canvas.fg-chart')];
		if (!canvases.length) return;
		const ids = canvases.flatMap(canvas => (canvas.dataset.series || '').split(',').filter(Boolean));
		const draw = () => this._body.querySelectorAll('canvas.fg-chart').forEach(canvas => this._drawChart(canvas, (canvas.dataset.series || '').split(',').filter(Boolean), 1, {compact: true}));
		draw();
		this._loadHistory(ids, 1).then(draw);
	}

	// Dibuja una gráfica de líneas en canvas (compacta en tarjetas o con ejes en la ventana emergente).
	_drawChart(canvas, itemids, hours, options = {}) {
		if (!canvas || !canvas.isConnected) return;
		const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
		const dpr = window.devicePixelRatio || 1; canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
		const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const w = rect.width, h = rect.height;
		const store = this._historyStore(hours);
		const from = Date.now() / 1000 - hours * 3600;
		const colors = WidgetLakaFortiGateOverview.COLORS;
		const series = itemids.map((id, index) => ({id, item: this._itemIndex.get(id), points: (store[id]?.points || []).filter(p => p[0] >= from), color: colors[index % colors.length]})).filter(s => s.points.length);
		const compact = options.compact === true, style = getComputedStyle(this._body), muted = style.getPropertyValue('--fg-muted').trim() || '#64748b', grid = style.getPropertyValue('--fg-grid').trim() || 'rgba(128,128,128,.16)';
		const pad = compact ? {l: 0, r: 0, t: 3, b: 1} : {l: 58, r: 14, t: 14, b: 27}, pw = Math.max(1, w - pad.l - pad.r), ph = Math.max(1, h - pad.t - pad.b);
		ctx.clearRect(0, 0, w, h); ctx.font = compact ? '9px sans-serif' : '10px sans-serif';
		if (!series.length) {
			const loaded = itemids.every(id => store[id]);
			const failed = itemids.some(id => store[id]?.error);
			ctx.fillStyle = muted; ctx.textBaseline = 'middle';
			ctx.fillText(this._t(failed ? 'Histórico no disponible' : loaded ? 'Sin histórico' : 'Cargando histórico…'), compact ? 8 : pad.l, compact ? h / 2 : pad.t + ph / 2);
			return;
		}
		const all = series.flatMap(s => s.points.map(p => p[1])), minT = from, maxT = Date.now() / 1000;
		let maxV = Math.max(1e-9, ...all), minV = Math.min(0, ...all);
		const unit = options.unit || this._chartUnit(series[0].item, '');
		if (unit === '%') {
			const isLoss = series.some(s => /\.loss\[|packets loss|icmppingloss/i.test(`${s.item?.key_ || ''} ${s.item?.name || ''}`));
			maxV = isLoss ? Math.max(maxV * 1.15, Number(this._payload.settings.loss_crit) || 20) : 100; minV = 0;
		}
		else { maxV = maxV === minV ? maxV + 1 : maxV + (maxV - minV) * .1; }
		ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textBaseline = 'middle';
		for (let i = 0; i <= 4; i++) {
			const y = pad.t + ph * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
			if (!compact) { const value = maxV - (maxV - minV) * i / 4; ctx.textAlign = 'right'; ctx.fillText(this._axisValue(value, unit), pad.l - 7, y); }
		}
		if (!compact) {
			ctx.textBaseline = 'top';
			for (let i = 0; i <= 4; i++) {
				const x = pad.l + pw * i / 4, time = new Date((minT + (maxT - minT) * i / 4) * 1000);
				ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
				ctx.fillText(hours > 24 ? time.toLocaleString(this._locale(), {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : time.toLocaleTimeString(this._locale(), {hour: '2-digit', minute: '2-digit'}), x, pad.t + ph + 8);
			}
		}
		series.forEach(s => {
			const points = s.points.map(p => ({x: pad.l + (p[0] - minT) / Math.max(1, maxT - minT) * pw, y: pad.t + ph - (p[1] - minV) / Math.max(1e-9, maxV - minV) * ph})); if (!points.length) return;
			const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph); fill.addColorStop(0, `${s.color}30`); fill.addColorStop(1, `${s.color}03`);
			ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.lineTo(points[points.length - 1].x, pad.t + ph); ctx.lineTo(points[0].x, pad.t + ph); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
			ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = compact ? 1.8 : 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
			if (!compact) { const last = points[points.length - 1]; ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(last.x, last.y, 3, 0, Math.PI * 2); ctx.fill(); }
		});
	}

	// Ventana emergente con el histórico y selector de periodo.
	_openChart(title, itemids, units) {
		this._closeModal();
		const max = Math.max(1, Number(this._payload.settings.history_hours) || 1), periods = [1, 3, 6, 12, 24, 72, 168].filter(h => h <= max);
		if (!periods.includes(max)) periods.push(max);
		const initial = periods[0];
		const groups = this._chartGroups(itemids, units);
		const period = hours => hours < 24 ? `${hours} h` : `${hours / 24} d`;
		this._modal = document.createElement('div'); this._modal.className = 'fg-modal';
		this._modal.setAttribute('lang', this._locale());
		const theme = getComputedStyle(this._body);
		['--fg-panel', '--fg-panel-soft', '--fg-text', '--fg-muted', '--fg-border', '--fg-grid', '--fg-accent', '--fg-blue', '--fg-green', '--fg-amber', '--fg-red'].forEach(name => this._modal.style.setProperty(name, theme.getPropertyValue(name)));
		this._modal.innerHTML = `<div class="fg-modal-card" role="dialog" aria-modal="true"><header><div><h3>${this._e(title)}</h3><p data-modal-status>${this._e(this._t('Histórico de Zabbix · cargando…'))}</p></div><button class="fg-modal-close" title="${this._e(this._t('Cerrar'))}">×</button></header><div class="fg-periods">${periods.map(h => `<button data-hours="${h}" class="${h === initial ? 'is-active' : ''}">${h < 24 ? h + 'h' : h / 24 + 'd'}</button>`).join('')}</div><div class="fg-modal-charts">${groups.map((group, index) => `<section class="fg-modal-section"><div class="fg-chart-heading"><strong>${this._e(this._groupTitle(group.unit))}</strong><span>${this._e(group.unit || this._t('valor'))}</span></div><canvas class="fg-modal-chart" data-group="${index}"></canvas><div class="fg-chart-stats" data-stats="${index}"></div></section>`).join('')}</div><footer class="fg-modal-footer">${this._authorship()}</footer></div>`;
		document.body.appendChild(this._modal);
		const modal = this._modal;
		const status = modal.querySelector('[data-modal-status]');
		const render = hours => groups.forEach((group, index) => {
			this._drawChart(modal.querySelector(`[data-group="${index}"]`), group.itemids, hours, {unit: group.unit});
			modal.querySelector(`[data-stats="${index}"]`).innerHTML = this._chartStats(group.itemids, hours, group.unit);
		});
		const load = hours => {
			render(hours);
			status.textContent = this._t('Histórico de Zabbix · {0} · cargando…', period(hours));
			this._loadHistory(itemids, hours).then(store => {
				if (this._modal !== modal) return;
				const failed = itemids.find(id => store[id]?.error);
				status.textContent = failed ? this._t('No se pudo obtener el histórico: {0}', store[failed].error) : this._t('Histórico de Zabbix · {0} · tendencias horarias para periodos largos', period(hours));
				render(hours);
			});
		};
		load(initial);
		const close = () => this._closeModal();
		modal.querySelector('.fg-modal-close').addEventListener('click', close);
		modal.addEventListener('click', event => { if (event.target === modal) close(); });
		modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
		modal.querySelector('.fg-modal-close').focus();
		modal.querySelectorAll('.fg-periods button').forEach(button => button.addEventListener('click', () => {
			modal.querySelectorAll('.fg-periods button').forEach(other => other.classList.toggle('is-active', other === button));
			load(Number(button.dataset.hours));
		}));
		this._modalResizeHandler = () => { const active = modal.querySelector('.fg-periods button.is-active'); if (active) render(Number(active.dataset.hours)); };
		window.addEventListener('resize', this._modalResizeHandler);
	}

	// Separa las series por unidad para no mezclar escalas (bps, ms, %…).
	_chartGroups(itemids, fallback = '') {
		const groups = [];
		itemids.forEach(id => {
			const unit = this._chartUnit(this._itemIndex.get(id), fallback), group = groups.find(row => row.unit === unit);
			group ? group.itemids.push(id) : groups.push({unit, itemids: [id]});
		});
		return groups;
	}
	_chartUnit(item, fallback = '') {
		const key = item?.key_ || '', name = item?.name || '', unit = (item?.units || '').trim();
		if (/netif\.(in|out)\[|net\.if\.(in|out)\[|wc\.rate\./.test(key)) return 'bps';
		if (/\.loss\[|packets loss|icmppingloss/i.test(`${key} ${name}`)) return '%';
		if (/icmppingsec/.test(key)) return 's';
		if (/\.latency\[|\.jitter\[|latency|jitter/i.test(`${key} ${name}`)) return 'ms';
		return unit || fallback || '';
	}
	_groupTitle(unit) {
		const titles = {bps: 'Tráfico de red', Bps: 'Tráfico (bytes/s)', ms: 'Latencia y jitter', s: 'Tiempo de respuesta', '%': 'Porcentaje', B: 'Bytes'};
		return this._t(titles[unit] || 'Medición');
	}
	_axisValue(value, unit) {
		if (unit === 'bps') return this._bits(value);
		if (unit === 'Bps') return `${this._bytes(value)}/s`;
		if (unit === 'B') return this._bytes(value);
		if (unit === '%') return `${this._fmt(value)}%`;
		if (unit === 'ms') return `${this._fmt(value)} ms`;
		if (unit === 's') return `${this._fmt(value * 1000)} ms`;
		return Math.abs(value) < 10 ? this._rate(value) : this._compact(value);
	}
	_shortItemName(name) { return String(name || '').replace(/^SD-WAN\s+\[[^\]]+\]:\[[^\]]+\]:\s*/i, '').replace(/^Interface\s+\[?[^:]+\]?:\s*/i, '').replace(/^(FW Policy|Service)\s+\[[^\]]+\]:\s*/i, '').replace(/^(HA|VDOM|WTP|CPU Core|SoC3)\s+[^:]+:\s*/i, ''); }
	_chartStats(itemids, hours, unit) {
		const store = this._historyStore(hours), from = Date.now() / 1000 - hours * 3600, colors = WidgetLakaFortiGateOverview.COLORS;
		return itemids.map((id, index) => {
			const item = this._itemIndex.get(id), points = (store[id]?.points || []).filter(p => p[0] >= from);
			const color = colors[index % colors.length];
			if (!points.length) return `<div><i style="background:${color}"></i><strong>${this._e(this._shortItemName(item?.name || id))}</strong><span>${this._e(this._t(store[id] ? 'Sin histórico' : 'Cargando…'))}</span></div>`;
			const values = points.map(p => p[1]), last = values[values.length - 1];
			const min = Math.min(...points.map(p => p.length > 3 ? p[2] : p[1])), maxValue = Math.max(...points.map(p => p.length > 3 ? p[3] : p[1]));
			const avg = values.reduce((a, b) => a + b, 0) / values.length;
			const stat = (label, value) => `<span>${this._e(this._t(label))} <b>${this._e(this._axisValue(value, unit))}</b></span>`;
			return `<div><i style="background:${color}"></i><strong>${this._e(this._shortItemName(item?.name || id))}</strong>${stat('Actual', last)}${stat('Mín', min)}${stat('Prom', avg)}${stat('Máx', maxValue)}</div>`;
		}).join('');
	}

	/* ------------------------------------------------------------------ rotación y ventana emergente */

	// Recorre la vista de flota y cada firewall; se pausa con el cursor encima o con una gráfica abierta.
	_restartHostRotation() {
		this._stopHostRotation();
		const seconds = this._rotationSeconds();
		if (!seconds) return;
		this._rotationTimer = window.setInterval(() => {
			if (this._modal || this._body.matches(':hover')) return;
			const pages = [...(this._fleetEnabled() ? [WidgetLakaFortiGateOverview.FLEET] : []), ...this._payload.hosts.map(host => host.hostid)];
			const current = pages.indexOf(this._selected_hostid);
			this._selected_hostid = pages[(current + 1 + pages.length) % pages.length];
			this._selected_tab = 'overview';
			this._renderWidget();
		}, seconds * 1000);
	}
	_stopHostRotation() { if (this._rotationTimer !== null) { window.clearInterval(this._rotationTimer); this._rotationTimer = null; } }
	_closeModal() {
		if (this._modalResizeHandler) { window.removeEventListener('resize', this._modalResizeHandler); this._modalResizeHandler = null; }
		if (this._modal) { this._modal.remove(); this._modal = null; }
	}
}
