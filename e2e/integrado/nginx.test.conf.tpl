worker_processes 1; daemon off; pid __TMP__/nginx.pid; error_log __TMP__/error.log;
events { worker_connections 64; }
http {
  access_log off; client_body_temp_path __TMP__/b; proxy_temp_path __TMP__/p; fastcgi_temp_path __TMP__/f; uwsgi_temp_path __TMP__/u; scgi_temp_path __TMP__/s;
  include /etc/nginx/mime.types;
  server {
    listen 8080;
    location = /transportes { return 301 /transportes/; }
    location = /operaciones { return 301 /operaciones/; }
    location /auth/v1/ { proxy_pass http://127.0.0.1:9999; }
    location /__stats { proxy_pass http://127.0.0.1:9999; }
    location /operaciones/ { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; }
    location /transportes/ { alias __ROOT__/e2e/integrado/transportes-stub/; try_files $uri $uri/ /transportes/index.html; }
    location / { root __TMP__/portal; try_files $uri $uri/ /index.html; }
  }
}
