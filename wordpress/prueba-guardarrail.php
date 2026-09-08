<?php
/**
 * Prueba del guardarraíl del plugin SIN necesitar WordPress:
 * simulamos las funciones de WP que usa y comprobamos cuándo carga y cuándo no.
 *
 *   php wordpress/prueba-guardarrail.php
 */

define( 'ABSPATH', __DIR__ );

// ── estado simulado de WordPress
$GLOBALS['sim'] = array(
	'entorno' => 'production',
	'admin'   => false,
	'ajax'    => false,
	'cron'    => false,
	'feed'    => false,
	'opcion'  => array(),
);

function wp_get_environment_type() { return $GLOBALS['sim']['entorno']; }
function is_admin()   { return $GLOBALS['sim']['admin']; }
function wp_doing_ajax() { return $GLOBALS['sim']['ajax']; }
function wp_doing_cron() { return $GLOBALS['sim']['cron']; }
function is_feed()    { return $GLOBALS['sim']['feed']; }
function get_option( $k, $d = false ) { return $GLOBALS['sim']['opcion'] ?: $d; }
function wp_parse_args( $a, $d ) { return array_merge( $d, is_array( $a ) ? $a : array() ); }
function sanitize_title( $s ) { return strtolower( preg_replace( '/[^a-z0-9-]+/i', '-', $s ) ); }
function get_bloginfo( $x ) { return 'Cliente Ejemplo'; }
function apply_filters( $t, $v ) { return $v; }
function add_action() {} function add_filter() {} function add_options_page() {}
function register_setting() {} function register_uninstall_hook() {}
function plugin_basename( $f ) { return basename( $f ); }
function admin_url( $p ) { return 'https://x/' . $p; }
function esc_url( $u ) { return $u; } function esc_attr( $s ) { return $s; }
function esc_url_raw( $u ) { return $u; } function esc_html( $s ) { return $s; }
function sanitize_key( $s ) { return strtolower( preg_replace( '/[^a-z0-9_\-]/i', '', $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( $s ) ); }
function sanitize_hex_color( $c ) { return preg_match( '/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/', $c ) ? $c : null; }
function checked() {} function selected() {} function submit_button() {}
function settings_fields() {} function current_user_can( $c ) { return true; }
function delete_option( $k ) {}

require __DIR__ . '/feedtack/feedtack.php';

// ── casos
$fallos = array();
function caso( $nombre, $estado, $ajustes, $esperado ) {
	global $fallos;
	$GLOBALS['sim'] = array_merge(
		array( 'entorno' => 'production', 'admin' => false, 'ajax' => false, 'cron' => false, 'feed' => false, 'opcion' => array() ),
		$estado
	);
	// partimos de ajustes completos: el caso "sin endpoint" se prueba explícitamente abajo
	$base = array_merge( feedtack_por_defecto(), array( 'endpoint' => 'https://ejemplo.test' ) );
	$GLOBALS['sim']['opcion'] = array_merge( $base, $ajustes );
	$real = feedtack_debe_cargar();
	$ok   = ( $real === $esperado );
	printf( "  %s  %-58s esperado:%-3s real:%s\n", $ok ? 'ok ' : 'MAL', $nombre, $esperado ? 'sí' : 'no', $real ? 'sí' : 'no' );
	if ( ! $ok ) { $fallos[] = $nombre; }
}

echo "Guardarraíl de entorno\n";
caso( 'produccion, sin forzar: NO carga',            array( 'entorno' => 'production' ),  array(), false );
caso( 'produccion, forzado a mano: carga',           array( 'entorno' => 'production' ),  array( 'en_produccion' => 1 ), true );
caso( 'staging: carga',                              array( 'entorno' => 'staging' ),     array(), true );
caso( 'development: carga',                          array( 'entorno' => 'development' ), array(), true );
caso( 'local: carga',                                array( 'entorno' => 'local' ),       array(), true );

echo "\nInterruptor de los ajustes\n";
caso( 'desactivado en staging: NO carga',            array( 'entorno' => 'staging' ), array( 'activo' => 0 ), false );
caso( 'desactivado y forzado en produccion: NO carga', array( 'entorno' => 'production' ), array( 'activo' => 0, 'en_produccion' => 1 ), false );

echo "\nContextos donde nunca debe salir\n";
caso( 'escritorio de WordPress: NO carga',           array( 'entorno' => 'staging', 'admin' => true ), array(), false );
caso( 'peticion ajax: NO carga',                     array( 'entorno' => 'staging', 'ajax' => true ),  array(), false );
caso( 'cron: NO carga',                              array( 'entorno' => 'staging', 'cron' => true ),  array(), false );
caso( 'feed rss: NO carga',                          array( 'entorno' => 'staging', 'feed' => true ),  array(), false );

echo "\nAjustes incompletos\n";
caso( 'sin identificador de cliente: NO carga',      array( 'entorno' => 'staging' ), array( 'site' => '' ), false );
caso( 'sin servidor configurado: NO carga',          array( 'entorno' => 'staging' ), array( 'endpoint' => '' ), false );
caso( 'sin fichero de widget: NO carga',             array( 'entorno' => 'staging' ), array( 'script' => '' ), false );

// ── saneado de la entrada
echo "\nSaneado de lo que se escribe en el formulario\n";
$pruebas = array(
	array( 'endpoint http se rechaza y queda vacio', array( 'endpoint' => 'http://malo.example' ), 'endpoint', '' ),
	array( 'endpoint javascript: se rechaza',        array( 'endpoint' => 'javascript:alert(1)' ), 'endpoint', '' ),
	array( 'endpoint https valido se acepta',        array( 'endpoint' => 'https://mio.example' ), 'endpoint', 'https://mio.example' ),
	array( 'script javascript: se rechaza',          array( 'script' => 'javascript:alert(1)' ),   'script',   'https://cdn.jsdelivr.net/gh/alvaromassana/feedtack@main/widget/feedtack.js' ),
	array( 'color invalido se rechaza',  array( 'color' => 'rojo; background:url(x)' ), 'color',   '#4f46e5' ),
	array( 'color valido se acepta',     array( 'color' => '#9a6b45' ),                 'color',   '#9a6b45' ),
	array( 'posicion inventada se rechaza', array( 'posicion' => 'centro-raro' ),       'posicion','bottom-right' ),
	array( 'etiqueta con html se limpia', array( 'label' => '<b onclick=x>Hola</b>' ),  'label',   'Hola' ),
);
foreach ( $pruebas as $p ) {
	list( $nombre, $entrada, $campo, $esperado ) = $p;
	$r  = feedtack_sanear( array_merge( feedtack_por_defecto(), $entrada ) );
	$ok = ( $r[ $campo ] === $esperado );
	printf( "  %s  %-58s %s\n", $ok ? 'ok ' : 'MAL', $nombre, $ok ? '' : "dio: '{$r[$campo]}'" );
	if ( ! $ok ) { $fallos[] = $nombre; }
}

echo "\n" . ( $fallos ? 'FALLOS: ' . implode( ', ', $fallos ) : 'TODO CORRECTO' ) . "\n";
exit( $fallos ? 1 : 0 );
