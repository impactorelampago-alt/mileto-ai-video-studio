#!/usr/bin/env bash
set -euo pipefail

# Configura o armazenamento Compartilhado sem imprimir credenciais no terminal.
# Execute na raiz do gateway: bash scripts/configure-r2.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
BACKUP_DIR="${MILETO_BACKUP_DIR:-/opt/backups}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Arquivo $ENV_FILE não encontrado."
    exit 1
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Arquivo $COMPOSE_FILE não encontrado."
    exit 1
fi

read -r -p "R2 Account ID: " account_id
read -r -p "R2 Access Key ID: " access_key_id
read -r -s -p "R2 Secret Access Key: " secret_access_key
printf '\n'
read -r -p "Nome do bucket R2 já criado: " bucket
read -r -p "Validade dos links em segundos [3600]: " download_ttl
download_ttl="${download_ttl:-3600}"

for value_name in account_id access_key_id secret_access_key bucket; do
    if [[ -z "${!value_name}" ]]; then
        echo "Todos os quatro campos R2 são obrigatórios."
        exit 1
    fi
done
if [[ ! "$download_ttl" =~ ^[0-9]+$ ]] || (( download_ttl < 60 )); then
    echo "A validade precisa ser um número igual ou superior a 60 segundos."
    exit 1
fi

dotenv_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
backup="$BACKUP_DIR/mileto-gateway-env-before-r2-$stamp"
cp "$ENV_FILE" "$backup"
chmod 600 "$backup"

temp_file="$(mktemp "$ROOT_DIR/.env.r2.XXXXXX")"
chmod 600 "$temp_file"
rollback_required=false
on_exit() {
    status=$?
    trap - EXIT
    rm -f "$temp_file"
    if (( status != 0 )) && [[ "$rollback_required" == "true" ]]; then
        cp "$backup" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        cd "$ROOT_DIR"
        docker compose -f "$COMPOSE_FILE" up -d --build gateway >/dev/null 2>&1 || true
        echo "A validação falhou; o .env anterior foi restaurado automaticamente."
    fi
    exit "$status"
}
trap on_exit EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
        R2_ACCOUNT_ID=*|R2_ACCESS_KEY_ID=*|R2_SECRET_ACCESS_KEY=*|R2_BUCKET=*|R2_DOWNLOAD_URL_TTL=*) ;;
        *) printf '%s\n' "$line" >> "$temp_file" ;;
    esac
done < "$ENV_FILE"

{
    printf 'R2_ACCOUNT_ID=%s\n' "$(dotenv_quote "$account_id")"
    printf 'R2_ACCESS_KEY_ID=%s\n' "$(dotenv_quote "$access_key_id")"
    printf 'R2_SECRET_ACCESS_KEY=%s\n' "$(dotenv_quote "$secret_access_key")"
    printf 'R2_BUCKET=%s\n' "$(dotenv_quote "$bucket")"
    printf 'R2_DOWNLOAD_URL_TTL=%s\n' "$download_ttl"
} >> "$temp_file"

mv "$temp_file" "$ENV_FILE"
chmod 600 "$ENV_FILE"
rollback_required=true

cd "$ROOT_DIR"
docker compose -f "$COMPOSE_FILE" up -d --build gateway

for _ in {1..30}; do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' mileto-gateway 2>/dev/null || true)" == "healthy" ]]; then
        break
    fi
    sleep 2
done
if [[ "$(docker inspect --format '{{.State.Health.Status}}' mileto-gateway 2>/dev/null || true)" != "healthy" ]]; then
    echo "O gateway não ficou saudável. Restaure o backup: $backup"
    exit 1
fi

# Prova real de leitura e escrita. O objeto temporário é apagado no final.
docker exec -i mileto-gateway node --input-type=module <<'NODE'
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
const bucket = process.env.R2_BUCKET;
const key = `_health/mileto-shared-${Date.now()}.txt`;
try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'mileto-r2-ok', ContentType: 'text/plain' }));
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.log('Cloudflare R2: leitura e gravação confirmadas.');
} finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
}
NODE

rollback_required=false
echo "Compartilhado configurado. Backup anterior: $backup"
