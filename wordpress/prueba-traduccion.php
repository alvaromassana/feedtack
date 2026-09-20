<?php
/**
 * Does every translatable string in the plugin have its Spanish translation?
 *
 *   php wordpress/prueba-traduccion.php
 *
 * 🔒 Why it exists: the plugin's source strings are English now, and Spanish ships in
 * languages/feedtack-es_ES.po. The failure mode is mute and certain: somebody adds a
 * string, does not regenerate the catalogue, and the settings page comes out half in
 * English for everyone reading it in Spanish. Nothing errors, nothing logs.
 *
 * Checks, in order:
 *   1. every __() / _e() / esc_html__() / esc_html_e() / esc_attr__() literal in the PHP
 *      exists as a msgid in the .po, and has a non-empty msgstr
 *   2. every call uses the 'feedtack' text domain and no other
 *   3. the .mo and the .l10n.php are there and are newer than the .po (not stale)
 *   4. printf placeholders match between original and translation: a %1$s that becomes
 *      %s in Spanish is a PHP warning on somebody else's site
 *
 * Exits 1 on a real problem, 2 when it cannot look (missing files), never 0 by accident.
 */

$raiz  = __DIR__;
$php   = $raiz . '/feedtack/feedtack.php';
$po    = $raiz . '/feedtack/languages/feedtack-es_ES.po';
$mo    = $raiz . '/feedtack/languages/feedtack-es_ES.mo';
$l10n  = $raiz . '/feedtack/languages/feedtack-es_ES.l10n.php';

foreach ( array( $php, $po, $mo, $l10n ) as $f ) {
	if ( ! is_readable( $f ) ) {
		fwrite( STDERR, "NO SE HA PODIDO MIRAR: falta $f\n" );
		exit( 2 );
	}
}

$fuente = file_get_contents( $php );
$fallos = array();
$ok     = function ( $m ) { echo "  ok   $m\n"; };
$mal    = function ( $m ) use ( &$fallos ) { echo "  FALLA $m\n"; $fallos[] = $m; };

// ── 1. qué cadenas pide el código
preg_match_all(
	'/\b(?:esc_html__|esc_html_e|esc_attr__|esc_attr_e|__|_e)\(\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")\s*,\s*(\'[^\']*\'|"[^"]*")\s*\)/',
	$fuente, $m, PREG_SET_ORDER
);
if ( ! $m ) {
	fwrite( STDERR, "NO SE HA PODIDO MIRAR: no encuentro ni una llamada de traducción en el plugin\n" );
	exit( 2 );
}

$pedidas = array();
foreach ( $m as $c ) {
	$texto   = stripcslashes( substr( $c[1], 1, -1 ) );
	$dominio = trim( $c[2], '\'"' );
	if ( 'feedtack' !== $dominio ) {
		$mal( "dominio equivocado ('$dominio') en: " . substr( $texto, 0, 40 ) );
		continue;
	}
	$pedidas[ $texto ] = true;
}
echo "\nCadenas traducibles en el plugin: " . count( $pedidas ) . "\n\n";

// ── 2. qué hay en el catálogo
$catalogo = array();
$lineas   = file( $po, FILE_IGNORE_NEW_LINES );
$id       = null;
foreach ( $lineas as $l ) {
	if ( preg_match( '/^msgid "(.*)"$/', $l, $x ) ) {
		$id = stripcslashes( $x[1] );
	} elseif ( preg_match( '/^msgstr "(.*)"$/', $l, $x ) && null !== $id ) {
		$catalogo[ $id ] = stripcslashes( $x[1] );
		$id              = null;
	}
}
if ( count( $catalogo ) < 2 ) {
	fwrite( STDERR, "NO SE HA PODIDO MIRAR: el .po no tiene entradas legibles\n" );
	exit( 2 );
}

// ── 3. cada cadena pedida, traducida
$sin = 0;
foreach ( array_keys( $pedidas ) as $texto ) {
	if ( ! isset( $catalogo[ $texto ] ) ) {
		$mal( 'no está en el catálogo: "' . substr( $texto, 0, 50 ) . '"' );
		$sin++;
	} elseif ( '' === $catalogo[ $texto ] ) {
		$mal( 'está en el catálogo SIN traducir: "' . substr( $texto, 0, 50 ) . '"' );
		$sin++;
	}
}
if ( ! $sin ) {
	$ok( 'las ' . count( $pedidas ) . ' cadenas del plugin tienen traducción' );
}

// ── 4. los marcadores de printf tienen que coincidir
$desajuste = 0;
foreach ( $pedidas as $texto => $_ ) {
	if ( ! isset( $catalogo[ $texto ] ) || '' === $catalogo[ $texto ] ) {
		continue;
	}
	preg_match_all( '/%(\d+\$)?[sd]/', $texto, $a );
	preg_match_all( '/%(\d+\$)?[sd]/', $catalogo[ $texto ], $b );
	sort( $a[0] );
	sort( $b[0] );
	if ( $a[0] !== $b[0] ) {
		$mal( 'los marcadores no cuadran en: "' . substr( $texto, 0, 40 ) . '" (' .
			implode( ',', $a[0] ) . ' vs ' . implode( ',', $b[0] ) . ')' );
		$desajuste++;
	}
}
if ( ! $desajuste ) {
	$ok( 'los marcadores de printf cuadran entre original y traducción' );
}

// ── 5. lo compilado no puede ser más viejo que su fuente
foreach ( array( $mo => '.mo', $l10n => '.l10n.php' ) as $f => $nombre ) {
	if ( filemtime( $f ) < filemtime( $po ) ) {
		$mal( "el $nombre es más viejo que el .po: hay que volver a compilarlo con wp i18n" );
	}
}
if ( ! $fallos ) {
	$ok( 'el .mo y el .l10n.php están al día' );
}

echo "\n" . ( $fallos ? 'FALLOS: ' . count( $fallos ) : 'TODO CORRECTO' ) . "\n";
exit( $fallos ? 1 : 0 );
