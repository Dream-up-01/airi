#!/usr/bin/env bash
set -euo pipefail

readonly blob_digest='16b83be682148a4d8201dbf720ea7eace5de98b69f63f05e0c908b4d7977ecb5'
readonly blob_size=3295612928
readonly chunk_size=8388608
readonly source_url="https://registry.ollama.ai/v2/library/qwen3-vl/blobs/sha256:${blob_digest}"

destination="${1:?destination path is required}"
connections="${2:-4}"
part_directory="${destination}.parts"
chunk_count=$(((blob_size + chunk_size - 1) / chunk_size))

if [[ ! -d "$(dirname "${destination}")" ]]; then
  echo 'destination-directory-missing' >&2
  exit 2
fi
if ((connections < 1 || connections > 8)); then
  echo 'connection-count-invalid' >&2
  exit 2
fi

mkdir -p "${part_directory}"

download_chunk() {
  local index="$1"
  local start=$((index * chunk_size))
  local end=$((start + chunk_size - 1))
  if ((end >= blob_size)); then
    end=$((blob_size - 1))
  fi
  local expected_size=$((end - start + 1))
  local part_path
  part_path=$(printf '%s/chunk-%04d.bin' "${part_directory}" "${index}")
  local temporary_path="${part_path}.tmp"

  if [[ -f "${part_path}" ]] && [[ $(stat -c '%s' "${part_path}") -eq ${expected_size} ]]; then
    return
  fi

  rm -f -- "${temporary_path}"
  for _attempt in $(seq 1 50); do
    if curl --http2 --fail --location --silent --show-error \
      --retry 20 --retry-all-errors --retry-delay 2 \
      --connect-timeout 30 --speed-time 120 --speed-limit 1024 \
      --range "${start}-${end}" --output "${temporary_path}" "${source_url}"; then
      if [[ $(stat -c '%s' "${temporary_path}") -eq ${expected_size} ]]; then
        mv -f -- "${temporary_path}" "${part_path}"
        return
      fi
    fi
    rm -f -- "${temporary_path}"
    sleep 2
  done

  echo "chunk-retry-exhausted:${index}" >&2
  return 1
}

export blob_digest blob_size chunk_size source_url destination part_directory
export -f download_chunk
seq 0 $((chunk_count - 1)) | xargs -P "${connections}" -n 1 bash -c 'download_chunk "$1"' _

temporary_destination="${destination}.tmp"
rm -f -- "${temporary_destination}"
for index in $(seq 0 $((chunk_count - 1))); do
  part_path=$(printf '%s/chunk-%04d.bin' "${part_directory}" "${index}")
  cat -- "${part_path}" >> "${temporary_destination}"
done

if [[ $(stat -c '%s' "${temporary_destination}") -ne ${blob_size} ]]; then
  echo 'combined-size-invalid' >&2
  exit 3
fi
actual_digest=$(sha256sum "${temporary_destination}" | cut -d ' ' -f 1)
if [[ "${actual_digest}" != "${blob_digest}" ]]; then
  echo 'combined-digest-invalid' >&2
  exit 3
fi

mv -f -- "${temporary_destination}" "${destination}"
printf 'verified:%s\n' "${actual_digest}"
