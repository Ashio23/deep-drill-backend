ui = true
disable_mlock = true
api_addr = "https://127.0.0.1:8200"
cluster_addr = "https://127.0.0.1:8201"
storage "raft" {
  path = "/opt/openbao/data"
  node_id = "deepdrill-vps-1"
}
listener "tcp" {
  address = "127.0.0.1:8200"
  cluster_address = "127.0.0.1:8201"
  tls_cert_file = "/opt/openbao/tls/server.crt"
  tls_key_file = "/opt/openbao/tls/server.key"
  tls_min_version = "tls12"
}
