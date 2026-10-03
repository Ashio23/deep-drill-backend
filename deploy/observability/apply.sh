#!/usr/bin/env bash
# Run as root on the VPS, after installing Grafana OSS, Loki and Alloy.
# Credentials must already exist in /etc/deepdrill/observability (root:root 0600).
set -euo pipefail
src=$(cd -- "$(dirname -- "$0")" && pwd)
for f in admin-password secret-key; do
 test -s "/etc/deepdrill/observability/$f"
done
systemctl stop loki.service
getent group loki >/dev/null || groupadd --system loki
usermod -g loki loki
install -o loki -g loki -d -m 750 /var/lib/loki
install -m 644 "$src/loki.yml" /etc/loki/config.yml
install -m 640 -o root -g grafana "$src/grafana.ini" /etc/grafana/grafana.ini
install -m 644 "$src/config.alloy" /etc/alloy/config.alloy
install -m 644 "$src/alloy.default" /etc/default/alloy
usermod -aG adm,systemd-journal alloy
for svc in loki alloy grafana-server; do
 install -d -m 755 "/etc/systemd/system/$svc.service.d"
 install -m 644 "$src/$svc.service.conf" "/etc/systemd/system/$svc.service.d/observability.conf"
done
install -d -m 755 /etc/grafana/provisioning/datasources /etc/grafana/provisioning/dashboards /etc/grafana/dashboards
install -m 644 "$src/datasource.yml" /etc/grafana/provisioning/datasources/apis.yml
install -m 644 "$src/dashboards.yml" /etc/grafana/provisioning/dashboards/apis.yml
install -m 644 "$src/apis-dashboard.json" /etc/grafana/dashboards/apis.json
for dir in /usr/local/hestia/data/templates/web/nginx /usr/local/hestia/data/templates/web/nginx/php-fpm; do
 install -m 644 "$src/deepdrill-logs.tpl" "$src/deepdrill-logs.stpl" "$dir/"
done
/usr/bin/loki -config.file=/etc/loki/config.yml -verify-config=true
/usr/bin/alloy validate /etc/alloy/config.alloy
systemctl unmask grafana-server.service alloy.service loki.service
systemctl daemon-reload
systemctl enable loki grafana-server alloy
systemctl restart loki grafana-server alloy
systemctl is-active loki grafana-server alloy
