#!/bin/bash
# Rebuilds wordpress/feedtack.zip.
#
# 🔴 It exists because the plugin carries its own copy of widget/feedtack.js INSIDE it
# (since 19 September 2026, so an installed site depends neither on our repository nor on
# jsDelivr). Two copies of the same file drift apart on their own: this always copies from
# the original and runs the test bank before packing. CI checks the three copies match.
set -euo pipefail
cd "$(dirname "$0")"

cp ../widget/feedtack.js feedtack/feedtack.js
php -l feedtack/feedtack.php >/dev/null
node --check feedtack/feedtack.js
php prueba-guardarrail.php >/dev/null || { echo "FAILED: the plugin test bank does not pass"; exit 1; }
php prueba-traduccion.php >/dev/null || { echo "FAILED: some string has no Spanish translation, or the .mo is stale"; exit 1; }

rm -f feedtack.zip
zip -rq feedtack.zip feedtack -x '*.DS_Store'
unzip -l feedtack.zip
