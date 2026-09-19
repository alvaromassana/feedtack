#!/bin/bash
# Reconstruye wordpress/feedtack.zip.
#
# 🔴 Existe porque el plugin lleva DENTRO su copia de widget/feedtack.js (desde el
# 19-sep-2026, para que una web instalada no dependa de nuestro repo ni de jsDelivr).
# Dos copias del mismo fichero se desincronizan solas: aqui se copia siempre desde el
# original y se pasa el banco de pruebas antes de empaquetar.
set -euo pipefail
cd "$(dirname "$0")"

cp ../widget/feedtack.js feedtack/feedtack.js
php -l feedtack/feedtack.php >/dev/null
node --check feedtack/feedtack.js
php prueba-guardarrail.php >/dev/null || { echo "FALLA: el banco de pruebas del plugin no pasa"; exit 1; }

rm -f feedtack.zip
zip -rq feedtack.zip feedtack -x '*.DS_Store'
unzip -l feedtack.zip
