<?php declare(strict_types = 1);

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
