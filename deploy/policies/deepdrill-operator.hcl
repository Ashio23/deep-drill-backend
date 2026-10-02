path "secret/data/deepdrill/*" { capabilities = ["create", "read", "update", "patch", "delete"] }
path "secret/metadata/deepdrill/*" { capabilities = ["read", "list"] }
path "secret/metadata/deepdrill" { capabilities = ["list"] }
path "sys/health" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
path "auth/approle/role/deepdrill-*" { capabilities = ["read", "update", "create"] }
path "auth/userpass/users/deepdrill-operator/password" { capabilities = ["update"] }
