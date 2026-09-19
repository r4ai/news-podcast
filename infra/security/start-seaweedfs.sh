#!/bin/sh
set -eu
# Compose file-backed secrets retain host ownership. Copy into private tmpfs
# before the upstream entrypoint drops from root to the seaweed user.
cp /run/secrets/s3-identities /run/seaweedfs-secrets/s3-identities.json
chmod 0400 /run/seaweedfs-secrets/s3-identities.json
chown -R seaweed:seaweed /run/seaweedfs-secrets
exec /entrypoint.sh "$@"
