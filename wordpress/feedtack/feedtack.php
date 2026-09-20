<?php
/**
 * Plugin Name:       Feedtack
 * Plugin URI:        https://websalia.com
 * Description:       A floating button so your client can comment on the site they are reviewing, pointing at the exact element. Only loads outside production.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Websalia
 * Author URI:        https://websalia.com
 * License:           GPL-2.0-or-later
 * Text Domain:       feedtack
 * Domain Path:       /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FEEDTACK_VERSION', '1.0.0' );
define( 'FEEDTACK_OPCION', 'feedtack_ajustes' );

/**
 * The source strings are in English; the Spanish ones ship in languages/. WordPress 6.7+
 * loads a plugin's translations on its own, but this keeps working on 6.0, which is what
 * the header promises.
 */
function feedtack_idioma() {
	load_plugin_textdomain( 'feedtack', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'init', 'feedtack_idioma' );

/**
 * Defaults.
 */
function feedtack_por_defecto() {
	return array(
		'activo'      => 1,
		'site'        => sanitize_title( get_bloginfo( 'name' ) ),
		'endpoint'    => '',   // sin valor: cada quien apunta al suyo
		'script'      => '',   // vacio = la copia que viaja DENTRO del plugin
		'color'       => '#4f46e5',
		'label'       => '',   // vacío: lo pone el widget en el idioma del panel
		'posicion'    => 'borde-derecho',
		'idioma'      => '',   // Websalia 2026-09-07: vacio = lo decide el lang de la pagina
		'en_produccion' => 0,
	);
}

/**
 * Where the widget file comes from.
 *
 * 🔒 By default, from INSIDE the plugin. The default used to be the jsDelivr URL pointing at
 * @main, so every installed site was following the repository's main branch live: a broken
 * push over there broke the widget over here. The local copy depends on nobody.
 *
 * 🔴 The local URL is not saved in the options: plugins_url() changes if the site moves
 * domain or folder, and a saved absolute URL would keep pointing at the old one. It is
 * resolved on every load.
 */
function feedtack_url_script() {
	$a = feedtack_ajustes();
	if ( ! empty( $a['script'] ) ) {
		return $a['script'];
	}
	return plugins_url( 'feedtack.js', __FILE__ );
}

function feedtack_ajustes() {
	return wp_parse_args( get_option( FEEDTACK_OPCION, array() ), feedtack_por_defecto() );
}

/**
 * Should it load?
 *
 * 🔒 Hard guardrail: in production it does NOT load unless somebody ticked the box on
 * purpose. This widget is an internal review tool; if it slips onto the published site,
 * every visitor sees the button, can write comments and can read everyone else's.
 */
function feedtack_debe_cargar() {
	$a = feedtack_ajustes();

	if ( empty( $a['activo'] ) ) {
		return false;
	}
	if ( empty( $a['site'] ) || empty( $a['endpoint'] ) ) {
		return false;
	}
	// Nothing in the admin, nor in internal requests, nor in feeds.
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || is_feed() ) {
		return false;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return false;
	}

	$entorno = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
	if ( 'production' === $entorno && empty( $a['en_produccion'] ) ) {
		return false;
	}

	/**
	 * Last filter, in case a site needs to narrow it down (by role, by page...).
	 *
	 * @param bool $cargar
	 */
	return (bool) apply_filters( 'feedtack_debe_cargar', true );
}

/**
 * Injects the script in the footer. One single tag: the widget depends on nothing else.
 */
function feedtack_pintar() {
	if ( ! feedtack_debe_cargar() ) {
		return;
	}
	$a = feedtack_ajustes();

	printf(
		'<script src="%s?v=%s" data-site="%s" data-endpoint="%s" data-color="%s" data-label="%s" data-position="%s" data-lang="%s" defer></script>' . "\n",
		esc_url( feedtack_url_script() ),
		esc_attr( FEEDTACK_VERSION ),
		esc_attr( $a['site'] ),
		esc_url( $a['endpoint'] ),
		esc_attr( $a['color'] ),
		esc_attr( $a['label'] ),
		esc_attr( $a['posicion'] ),
		esc_attr( $a['idioma'] )
	);
}
add_action( 'wp_footer', 'feedtack_pintar', 99 );

/* ─────────────────────────────── settings ─────────────────────────────── */

function feedtack_menu() {
	add_options_page(
		'Feedtack',
		'Feedtack',
		'manage_options',
		'feedtack',
		'feedtack_pagina_ajustes'
	);
}
add_action( 'admin_menu', 'feedtack_menu' );

function feedtack_enlace_ajustes( $enlaces ) {
	$url = admin_url( 'options-general.php?page=feedtack' );
	array_unshift( $enlaces, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'feedtack' ) . '</a>' );
	return $enlaces;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'feedtack_enlace_ajustes' );

function feedtack_registrar() {
	register_setting(
		'feedtack_grupo',
		FEEDTACK_OPCION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'feedtack_sanear',
			'default'           => feedtack_por_defecto(),
		)
	);
}
add_action( 'admin_init', 'feedtack_registrar' );

/**
 * Everything coming in from the form is sanitised here, with no exception.
 */
function feedtack_sanear( $entrada ) {
	$d     = feedtack_por_defecto();
	$salida = array();

	$salida['activo']        = empty( $entrada['activo'] ) ? 0 : 1;
	$salida['en_produccion'] = empty( $entrada['en_produccion'] ) ? 0 : 1;

	$salida['site'] = isset( $entrada['site'] )
		? sanitize_key( substr( sanitize_title( $entrada['site'] ), 0, 80 ) )
		: $d['site'];

	foreach ( array( 'endpoint', 'script' ) as $campo ) {
		$url = isset( $entrada[ $campo ] ) ? esc_url_raw( trim( $entrada[ $campo ] ) ) : '';
		// https only: the widget travels with the client's comment.
		$salida[ $campo ] = ( $url && 0 === strpos( $url, 'https://' ) ) ? $url : $d[ $campo ];
		// Both accept empty: an empty endpoint turns the widget off, an empty script uses the local copy.
		if ( ! $url ) { $salida[ $campo ] = ''; }
	}

	$color = isset( $entrada['color'] ) ? sanitize_hex_color( trim( $entrada['color'] ) ) : '';
	$salida['color'] = $color ? $color : $d['color'];

	$salida['label'] = isset( $entrada['label'] )
		? substr( sanitize_text_field( $entrada['label'] ), 0, 40 )
		: $d['label'];
	if ( '' === $salida['label'] ) {
		$salida['label'] = $d['label'];
	}

	// `right-edge` is the documented name; `borde-derecho` is the one this was born with
	// and is what sits in the saved settings of every site that already has the plugin.
	$posiciones = array( 'borde-derecho', 'right-edge', 'bottom-right', 'bottom-left', 'top-right' );
	$salida['posicion'] = ( isset( $entrada['posicion'] ) && in_array( $entrada['posicion'], $posiciones, true ) )
		? $entrada['posicion']
		: $d['posicion'];

	// Empty = the page's lang attribute decides. This is needed when the site is in one
	// language and whoever reviews it speaks another, which is the normal case on a client
	// site: an English site being reviewed by a Spanish-speaking design team.
	$idiomas = array( '', 'es', 'en' );
	$salida['idioma'] = ( isset( $entrada['idioma'] ) && in_array( $entrada['idioma'], $idiomas, true ) )
		? $entrada['idioma']
		: $d['idioma'];

	return $salida;
}

function feedtack_pagina_ajustes() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$a       = feedtack_ajustes();
	$entorno = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
	$carga   = feedtack_debe_cargar();
	?>
	<div class="wrap">
		<h1>Feedtack</h1>
		<p style="max-width:46em">
			<?php esc_html_e( 'Puts a floating button on the site so your client can comment on what they see, pointing at the exact element. The comments arrive by email and stay in a list the client can read and edit.', 'feedtack' ); ?>
		</p>

		<div class="notice notice-<?php echo $carga ? 'success' : 'warning'; ?> inline" style="margin:16px 0;padding:12px">
			<p style="margin:0">
				<strong><?php echo $carga ? esc_html__( 'Right now it IS loading.', 'feedtack' ) : esc_html__( 'Right now it is NOT loading.', 'feedtack' ); ?></strong>
				<?php
				/* translators: %s: the environment WordPress reports, e.g. production. */
				printf( esc_html__( 'Environment detected: %s.', 'feedtack' ), '<code>' . esc_html( $entorno ) . '</code>' );
				?>
				<?php if ( ! $carga && 'production' === $entorno && empty( $a['en_produccion'] ) ) : ?>
					<br><?php esc_html_e( 'This site is production, so the widget is switched off for safety.', 'feedtack' ); ?>
				<?php elseif ( ! $carga && empty( $a['activo'] ) ) : ?>
					<br><?php esc_html_e( 'It is switched off in the settings below.', 'feedtack' ); ?>
				<?php endif; ?>
			</p>
		</div>

		<?php if ( 'production' === $entorno && ! empty( $a['en_produccion'] ) ) : ?>
			<div class="notice notice-error inline" style="margin:16px 0;padding:12px">
				<p style="margin:0"><strong><?php esc_html_e( 'Careful:', 'feedtack' ); ?></strong>
				<?php esc_html_e( 'it is forced on a production site. Every visitor sees the button, can write comments and can read everyone else\'s. Switch it off as soon as the review is over.', 'feedtack' ); ?></p>
			</div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'feedtack_grupo' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Active', 'feedtack' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[activo]" value="1" <?php checked( $a['activo'], 1 ); ?>>
							<?php esc_html_e( 'Load the widget on this site', 'feedtack' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_site"><?php esc_html_e( 'Client identifier', 'feedtack' ); ?></label></th>
					<td>
						<input type="text" id="feedtack_site" class="regular-text" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[site]" value="<?php echo esc_attr( $a['site'] ); ?>">
						<p class="description"><?php esc_html_e( 'Shows up in the email subject and keeps each site\'s comments apart. No spaces, no accents.', 'feedtack' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_endpoint"><?php esc_html_e( 'Server', 'feedtack' ); ?></label></th>
					<td>
						<input type="url" id="feedtack_endpoint" class="regular-text code" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[endpoint]" value="<?php echo esc_attr( $a['endpoint'] ); ?>">
						<p class="description"><?php esc_html_e( 'https only. This site\'s domain has to be allowed on the server, otherwise the browser blocks everything it sends.', 'feedtack' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_script"><?php esc_html_e( 'Widget file', 'feedtack' ); ?></label></th>
					<td>
						<input type="url" id="feedtack_script" class="regular-text code" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[script]" value="<?php echo esc_attr( $a['script'] ); ?>" placeholder="<?php echo esc_attr( plugins_url( 'feedtack.js', __FILE__ ) ); ?>">
						<p class="description"><?php esc_html_e( 'Leave it empty and the copy inside the plugin is used, which is the recommended way: this site then depends on nobody\'s repository or CDN. Put a URL here only if you want to serve the file from somewhere else.', 'feedtack' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_color"><?php esc_html_e( 'Colour', 'feedtack' ); ?></label></th>
					<td>
						<input type="text" id="feedtack_color" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[color]" value="<?php echo esc_attr( $a['color'] ); ?>" placeholder="#4f46e5" style="width:8em">
						<p class="description"><?php esc_html_e( 'Usually the client\'s brand colour.', 'feedtack' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_label"><?php esc_html_e( 'Button text', 'feedtack' ); ?></label></th>
					<td><input type="text" id="feedtack_label" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[label]" value="<?php echo esc_attr( $a['label'] ); ?>" class="regular-text"></td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_posicion"><?php esc_html_e( 'Position', 'feedtack' ); ?></label></th>
					<td>
						<select id="feedtack_posicion" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[posicion]">
							<?php
							/* 🔴 Un sitio que guardó `borde-derecho` antes del 20-sep-2026 tiene ese
							   valor en su base. Si el <select> solo conociera `right-edge`, se
							   pintaría sin nada seleccionado y el primer guardado le cambiaría la
							   posición sin que nadie lo pidiera. Se normaliza para pintar. */
							$posicion_actual = 'borde-derecho' === $a['posicion'] ? 'right-edge' : $a['posicion'];
							$opciones = array(
								'right-edge'   => __( 'Tab on the right edge (discreet)', 'feedtack' ),
								'bottom-right' => __( 'Bottom right', 'feedtack' ),
								'bottom-left'  => __( 'Bottom left', 'feedtack' ),
								'top-right'    => __( 'Top right', 'feedtack' ),
							);
							foreach ( $opciones as $valor => $texto ) {
								printf(
									'<option value="%s" %s>%s</option>',
									esc_attr( $valor ),
									selected( $posicion_actual, $valor, false ),
									esc_html( $texto )
								);
							}
							?>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_idioma"><?php esc_html_e( 'Panel language', 'feedtack' ); ?></label></th>
					<td>
						<select id="feedtack_idioma" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[idioma]">
							<?php
							$idiomas = array(
								''   => __( 'The page\'s own (automatic)', 'feedtack' ),
								'es' => 'Español',
								'en' => 'English',
							);
							foreach ( $idiomas as $valor => $texto ) {
								printf(
									'<option value="%s" %s>%s</option>',
									esc_attr( $valor ),
									selected( $a['idioma'], $valor, false ),
									esc_html( $texto )
								);
							}
							?>
						</select>
						<p class="description"><?php esc_html_e( 'Set it by hand when the site is in one language and whoever reviews it speaks another.', 'feedtack' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Production', 'feedtack' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[en_produccion]" value="1" <?php checked( $a['en_produccion'], 1 ); ?>>
							<?php esc_html_e( 'Load it even when the environment is production', 'feedtack' ); ?>
						</label>
						<p class="description">
							<?php
							printf(
								/* translators: 1: WP_ENVIRONMENT_TYPE constant, 2: wp-config.php file name. */
								esc_html__( 'Leave it unticked unless you know exactly what you are doing. The environment is set with %1$s in %2$s (local, development, staging or production).', 'feedtack' ),
								'<code>WP_ENVIRONMENT_TYPE</code>',
								'<code>wp-config.php</code>'
							);
							?>
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2><?php esc_html_e( 'How your team gets in', 'feedtack' ); ?></h2>
		<p style="max-width:46em">
			<?php
			printf(
				/* translators: %s: the URL parameter that carries the team key. */
				esc_html__( 'To mark comments as resolved or delete them, open the site once with %s. The key is then kept in that browser. Anyone without it can write, edit their own, and confirm or reopen what you have already resolved, but nothing else.', 'feedtack' ),
				'<code style="white-space:nowrap">?feedtack_admin=KEY</code>'
			);
			?>
		</p>
	</div>
	<?php
}

/**
 * On uninstall, leave no rubbish behind in the database.
 */
function feedtack_desinstalar() {
	delete_option( FEEDTACK_OPCION );
}
register_uninstall_hook( __FILE__, 'feedtack_desinstalar' );
