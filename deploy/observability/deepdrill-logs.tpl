server {
 listen %ip%:%web_port%;
 server_name %domain_idn% %alias_idn%;
 root %docroot%;
 error_log /var/log/nginx/domains/%domain%.error.log error;
 include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;
 client_max_body_size 2m;
 add_header X-Content-Type-Options nosniff always;
 location ~ /\.(?!well-known(?:/|$)) { deny all; }
 location / {
  proxy_pass http://127.0.0.1:3301;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_connect_timeout 5s;
  proxy_read_timeout 3600s;
  proxy_buffering off;
  access_log off;
 }
 include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
