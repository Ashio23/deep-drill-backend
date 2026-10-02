server {
 listen %ip%:%web_port%;
 server_name %domain_idn% %alias_idn%;
 root %docroot%;
 error_log /var/log/nginx/domains/%domain%.error.log error;
 include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;
 client_max_body_size 24k;
 add_header X-Content-Type-Options nosniff always;
 location ^~ /.well-known/acme-challenge/ { root %docroot%; try_files $uri =404; }
 location ~ /\. { deny all; }
 location = / { return 302 /api/v1/health; }
 location / {
  proxy_pass http://127.0.0.1:3200;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_connect_timeout 5s;
  proxy_read_timeout 30s;
  proxy_next_upstream off;
  access_log off;
 }
 include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
