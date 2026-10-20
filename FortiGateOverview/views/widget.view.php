<?php declare(strict_types = 1);
/*
** LAKA · FortiGate Overview
** © LAKA Soluciones Tecnológicas
**
** Autor:          LAKA Soluciones Tecnológicas
** Archivo:        views/widget.view.php
** Versión:        2.1.1
** Compatibilidad: Zabbix 7.0 – 7.4
** Descripción:    Vista del widget en el dashboard. Entrega los datos codificados en base64 al
**                 JavaScript (class.widget.js), que dibuja toda la interfaz.
*/

/** @var CView $this */
/** @var array $data */

$payload = base64_encode(json_encode($data['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
	| JSON_INVALID_UTF8_SUBSTITUTE));

$root = (new CDiv())
	->addClass('laka-fortigate-root')
	->setAttribute('data-payload', $payload);

(new CWidgetView($data))
	->addItem($root)
	->show();
