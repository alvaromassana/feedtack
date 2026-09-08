<?php
/**
 * Plugin Name:       Feedtack
 * Plugin URI:        https://websalia.com
 * Description:       Botón flotante para que el cliente comente su web durante la revisión, señalando el elemento concreto. Solo se carga en entornos que no son producción.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Websalia
 * Author URI:        https://websalia.com
 * License:           GPL-2.0-or-later
 * Text Domain:       feedtack
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FEEDTACK_VERSION', '1.0.0' );
define( 'FEEDTACK_OPCION', 'feedtack_ajustes' );

/**
 * Valores por defecto.
 */
function feedtack_por_defecto() {
	return array(
		'activo'      => 1,
		'site'        => sanitize_title( get_bloginfo( 'name' ) ),
		'endpoint'    => '',   // sin valor: cada quien apunta al suyo
		'script'      => 'https://cdn.jsdelivr.net/gh/alvaromassana/feedtack@main/widget/feedtack.js',
		'color'       => '#4f46e5',
		'label'       => 'Comentar',
		'posicion'    => 'borde-derecho',
		'idioma'      => '',   // Websalia 2026-09-07: vacio = lo decide el lang de la pagina
		'en_produccion' => 0,
	);
}

function feedtack_ajustes() {
	return wp_parse_args( get_option( FEEDTACK_OPCION, array() ), feedtack_por_defecto() );
}

/**
 * ¿Toca cargarlo?
 *
 * 🔒 Guardarraíl duro: en producción NO se carga salvo que alguien haya marcado
 * la casilla a propósito. Este widget es una herramienta de revisión interna;
 * si se cuela en la web publicada, cualquier visitante ve el botón, puede
 * escribir comentarios y puede leer los de los demás.
 */
function feedtack_debe_cargar() {
	$a = feedtack_ajustes();

	if ( empty( $a['activo'] ) ) {
		return false;
	}
	if ( empty( $a['site'] ) || empty( $a['endpoint'] ) || empty( $a['script'] ) ) {
		return false;
	}
	// Nada en el escritorio, ni en peticiones internas, ni en feeds.
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
	 * Último filtro por si un sitio necesita afinar (por rol, por página...).
	 *
	 * @param bool $cargar
	 */
	return (bool) apply_filters( 'feedtack_debe_cargar', true );
}

/**
 * Inyecta el script en el pie. Una sola etiqueta: el widget no depende de nada más.
 */
function feedtack_pintar() {
	if ( ! feedtack_debe_cargar() ) {
		return;
	}
	$a = feedtack_ajustes();

	printf(
		'<script src="%s?v=%s" data-site="%s" data-endpoint="%s" data-color="%s" data-label="%s" data-position="%s" data-lang="%s" defer></script>' . "\n",
		esc_url( $a['script'] ),
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

/* ─────────────────────────────── ajustes ─────────────────────────────── */

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
	array_unshift( $enlaces, '<a href="' . esc_url( $url ) . '">Ajustes</a>' );
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
 * Todo lo que entra del formulario se sanea aquí, sin excepción.
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
		// Solo https: el widget viaja con el comentario del cliente.
		$salida[ $campo ] = ( $url && 0 === strpos( $url, 'https://' ) ) ? $url : $d[ $campo ];
		if ( 'endpoint' === $campo && ! $url ) { $salida[ $campo ] = ''; }
	}

	$color = isset( $entrada['color'] ) ? sanitize_hex_color( trim( $entrada['color'] ) ) : '';
	$salida['color'] = $color ? $color : $d['color'];

	$salida['label'] = isset( $entrada['label'] )
		? substr( sanitize_text_field( $entrada['label'] ), 0, 40 )
		: $d['label'];
	if ( '' === $salida['label'] ) {
		$salida['label'] = $d['label'];
	}

	$posiciones = array( 'borde-derecho', 'bottom-right', 'bottom-left', 'top-right' );
	$salida['posicion'] = ( isset( $entrada['posicion'] ) && in_array( $entrada['posicion'], $posiciones, true ) )
		? $entrada['posicion']
		: $d['posicion'];

	// Vacío = lo decide el atributo lang de la página. Hace falta cuando la web
	// está en un idioma y quien la revisa habla otro (Arqués: web en inglés,
	// diseñadoras en español), que es lo normal en una web de cliente.
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
			Pone un botón flotante en la web para que el cliente comente lo que ve,
			señalando el elemento concreto. Los comentarios llegan por correo y quedan
			en una lista que el propio cliente puede consultar y editar.
		</p>

		<div class="notice notice-<?php echo $carga ? 'success' : 'warning'; ?> inline" style="margin:16px 0;padding:12px">
			<p style="margin:0">
				<strong>Ahora mismo <?php echo $carga ? 'SE ESTÁ CARGANDO' : 'NO se carga'; ?>.</strong>
				Entorno detectado: <code><?php echo esc_html( $entorno ); ?></code>.
				<?php if ( ! $carga && 'production' === $entorno && empty( $a['en_produccion'] ) ) : ?>
					<br>Este sitio es producción, así que el widget queda desactivado por seguridad.
				<?php elseif ( ! $carga && empty( $a['activo'] ) ) : ?>
					<br>Está desactivado en los ajustes de abajo.
				<?php endif; ?>
			</p>
		</div>

		<?php if ( 'production' === $entorno && ! empty( $a['en_produccion'] ) ) : ?>
			<div class="notice notice-error inline" style="margin:16px 0;padding:12px">
				<p style="margin:0"><strong>Cuidado:</strong> está forzado en un sitio de producción.
				Cualquier visitante ve el botón, puede escribir comentarios y puede leer los de los demás.
				Desactívalo en cuanto termine la revisión.</p>
			</div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'feedtack_grupo' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Activo</th>
					<td>
						<label>
							<input type="checkbox" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[activo]" value="1" <?php checked( $a['activo'], 1 ); ?>>
							Cargar el widget en esta web
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_site">Identificador del cliente</label></th>
					<td>
						<input type="text" id="feedtack_site" class="regular-text" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[site]" value="<?php echo esc_attr( $a['site'] ); ?>">
						<p class="description">Aparece en el asunto del correo y separa los comentarios de cada web. Sin espacios ni acentos.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_endpoint">Servidor</label></th>
					<td>
						<input type="url" id="feedtack_endpoint" class="regular-text code" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[endpoint]" value="<?php echo esc_attr( $a['endpoint'] ); ?>">
						<p class="description">Solo https. El dominio de esta web tiene que estar autorizado en el servidor, si no el navegador bloquea los envíos.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_script">Fichero del widget</label></th>
					<td>
						<input type="url" id="feedtack_script" class="regular-text code" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[script]" value="<?php echo esc_attr( $a['script'] ); ?>">
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_color">Color</label></th>
					<td>
						<input type="text" id="feedtack_color" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[color]" value="<?php echo esc_attr( $a['color'] ); ?>" placeholder="#4f46e5" style="width:8em">
						<p class="description">Normalmente el color de marca del cliente.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_label">Texto del botón</label></th>
					<td><input type="text" id="feedtack_label" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[label]" value="<?php echo esc_attr( $a['label'] ); ?>" class="regular-text"></td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_posicion">Posición</label></th>
					<td>
						<select id="feedtack_posicion" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[posicion]">
							<?php
							$opciones = array(
								'borde-derecho' => 'Pestaña pegada al borde derecho (discreta)',
								'bottom-right' => 'Abajo a la derecha',
								'bottom-left'  => 'Abajo a la izquierda',
								'top-right'    => 'Arriba a la derecha',
							);
							foreach ( $opciones as $valor => $texto ) {
								printf(
									'<option value="%s" %s>%s</option>',
									esc_attr( $valor ),
									selected( $a['posicion'], $valor, false ),
									esc_html( $texto )
								);
							}
							?>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="feedtack_idioma">Idioma del panel</label></th>
					<td>
						<select id="feedtack_idioma" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[idioma]">
							<?php
							$idiomas = array(
								''   => 'El de la página (automático)',
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
						<p class="description">Ponlo a mano cuando la web esté en un idioma y quien la revisa hable otro.</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Producción</th>
					<td>
						<label>
							<input type="checkbox" name="<?php echo esc_attr( FEEDTACK_OPCION ); ?>[en_produccion]" value="1" <?php checked( $a['en_produccion'], 1 ); ?>>
							Cargarlo también si el entorno es producción
						</label>
						<p class="description">
							Déjalo desmarcado salvo que sepas muy bien lo que haces. El entorno se define
							con <code>WP_ENVIRONMENT_TYPE</code> en <code>wp-config.php</code>
							(<code>local</code>, <code>development</code>, <code>staging</code> o <code>production</code>).
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2>Cómo entra el equipo</h2>
		<p style="max-width:46em">
			Para poder marcar comentarios como resueltos o eliminarlos, hay que abrir la web
			una vez con <code style="white-space:nowrap">?feedtack_admin=CLAVE</code>. La clave se queda guardada en ese
			navegador. Quien no la tenga puede escribir, editar lo suyo y confirmar o reabrir
			lo que ya hayáis resuelto, pero nada más.
		</p>
	</div>
	<?php
}

/**
 * Al desinstalar, no dejamos basura en la base de datos.
 */
function feedtack_desinstalar() {
	delete_option( FEEDTACK_OPCION );
}
register_uninstall_hook( __FILE__, 'feedtack_desinstalar' );
