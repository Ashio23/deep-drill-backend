vault {
  address = "https://127.0.0.1:8200"
  ca_cert = "/etc/deepdrill/openbao-ca.crt"
}
auto_auth {
  method "approle" {
    config = {
      role_id_file_path = "/run/credentials/deepdrill-api.service/role-id"
      secret_id_file_path = "/run/credentials/deepdrill-api.service/secret-id"
      remove_secret_id_file_after_reading = false
    }
  }
}
template_config {
  static_secret_render_interval = "1m"
  exit_on_retry_failure = true
}
exec {
  command = ["/usr/local/bin/node", "/home/deepdrill/apps/current/dist/main.js"]
  restart_on_secret_changes = "always"
  restart_stop_signal = "SIGTERM"
}
env_template "NODE_ENV" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.NODE_ENV }}{{ end }}"
  error_on_missing_key = true
}
env_template "PORT" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.PORT }}{{ end }}"
  error_on_missing_key = true
}
env_template "HOST" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.HOST }}{{ end }}"
  error_on_missing_key = true
}
env_template "TRUST_PROXY_LOOPBACK" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.TRUST_PROXY_LOOPBACK }}{{ end }}"
  error_on_missing_key = true
}
env_template "MAINTENANCE_MODE" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.MAINTENANCE_MODE }}{{ end }}"
  error_on_missing_key = true
}
env_template "MONGODB_URI" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.MONGODB_URI }}{{ end }}"
  error_on_missing_key = true
}
env_template "JWT_SECRET" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.JWT_SECRET }}{{ end }}"
  error_on_missing_key = true
}
env_template "JWT_EXPIRES_IN" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.JWT_EXPIRES_IN }}{{ end }}"
  error_on_missing_key = true
}
env_template "MAX_SESSIONS" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.MAX_SESSIONS }}{{ end }}"
  error_on_missing_key = true
}
env_template "CORS_ORIGINS" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.CORS_ORIGINS }}{{ end }}"
  error_on_missing_key = true
}
env_template "AUTH_RATE_LIMIT" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.AUTH_RATE_LIMIT }}{{ end }}"
  error_on_missing_key = true
}
env_template "AUTH_RATE_TTL_MS" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.AUTH_RATE_TTL_MS }}{{ end }}"
  error_on_missing_key = true
}
env_template "SWAGGER_ENABLED" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.SWAGGER_ENABLED }}{{ end }}"
  error_on_missing_key = true
}
env_template "AUTH_GOOGLE_ENABLED" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.AUTH_GOOGLE_ENABLED }}{{ end }}"
  error_on_missing_key = true
}
env_template "GOOGLE_CLIENT_ID" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.GOOGLE_CLIENT_ID }}{{ end }}"
  error_on_missing_key = true
}
env_template "AUTH_FACEBOOK_ENABLED" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.AUTH_FACEBOOK_ENABLED }}{{ end }}"
  error_on_missing_key = true
}
env_template "FACEBOOK_APP_ID" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.FACEBOOK_APP_ID }}{{ end }}"
  error_on_missing_key = true
}
env_template "FACEBOOK_APP_SECRET" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.FACEBOOK_APP_SECRET }}{{ end }}"
  error_on_missing_key = true
}
env_template "FACEBOOK_GRAPH_API_VERSION" {
  contents = "{{ with secret \"secret/data/deepdrill/production\" }}{{ .Data.data.FACEBOOK_GRAPH_API_VERSION }}{{ end }}"
  error_on_missing_key = true
}
