# Deep Drill VPS deployment

Production target: https://deepdrill.cl/api/v1, on the existing MiraEste VPS. Nginx/Hestia routes the dedicated domain to 127.0.0.1:3200. MiraEste retains its own user, directories, services and PostgreSQL. MongoDB and OpenBao bind only to loopback. No Mongo or OpenBao port is opened publicly.

Pushes to `main` run lint, formatting, unit tests, isolated real-Mongo integration tests, deployment safety tests and a Linux build. Only a successful verification can deploy. Pull requests never deploy. The `production` environment accepts the `main` branch; `DEPLOY_ENABLED` is the commissioning switch. Actions are pinned to commit SHAs. Production credentials are not in the build or repository.

GitHub's dedicated SSH key has a forced command and cannot open a shell, transfer arbitrary files, forward ports or restart other services. It can stream a checksummed runtime artifact to `/usr/local/bin/deepdrill-ci`. The receiver rejects path traversal, links, special files, unexpected top-level entries and oversized archives. Releases are unpacked as the unprivileged `deepdrill` user, activated by atomic symlink replacement and checked against Mongo-aware health. A failed replacement restores the previous release and restarts it. Data and secret changes are never rolled back by deployment. Five recent releases are retained.

The only GitHub deployment secrets are `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`. Database, JWT and provider secrets are in OpenBao KV v2 at `secret/deepdrill/production`. `deepdrill-api.service` runs OpenBao Agent, which authenticates via a least-privilege AppRole and injects environment variables into its Node child. Secret changes restart that child. The AppRole bootstrap files are root-owned and delivered through systemd credentials; no plaintext production `.env` is generated. The role can only read its one KV path.

OpenBao uses persistent single-node Raft, TLS on loopback and Shamir unseal. Recovery shares are stored outside the VPS. A server/OpenBao restart requires an operator to unseal it before new API processes can retrieve secrets. This is not a highly available cluster or an external KMS. Keep the recovery bundle somewhere independent of this server and test recovery before deleting its copies.

Files in this directory are installed by an administrator. The workflow deliberately cannot change systemd, sudoers, SSH, OpenBao policies or Hestia templates. The API uses `HOST=127.0.0.1` and `TRUST_PROXY_LOOPBACK=true`; the Nginx templates replace incoming forwarded-client headers. Never trust all proxies or expose the backend port while this setting is enabled.

`MAINTENANCE_MODE=true` rejects authentication routes with HTTP 503/Retry-After while health remains available. It is used to stop writes during final migration. `scripts/legacy-proxy.cjs` is an optional temporary Render command for installed clients using the former hostname; it forwards only the known API paths to deepdrill.cl and does not connect to Mongo or issue tokens. It needs no old database/provider/JWT secrets. New Android builds should use `https://deepdrill.cl/api/v1` directly.

Operational results, restore evidence, backup schedule and recovery commands are recorded in [OPERATIONS.md](OPERATIONS.md). Do not rerun an initial bootstrap against an existing database or regenerate JWT/provider credentials during a deployment.
