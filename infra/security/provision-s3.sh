#!/bin/sh
set -eu
# This one-shot infrastructure job creates only the configured bucket directory.
case "$S3_BUCKET" in
  ''|*[!a-z0-9.-]*) echo 'Invalid bucket name' >&2; exit 1 ;;
esac
printf 'fs.mkdir /buckets/%s\n' "$S3_BUCKET" | weed shell -master=seaweedfs:9333 -filer=seaweedfs:8888
