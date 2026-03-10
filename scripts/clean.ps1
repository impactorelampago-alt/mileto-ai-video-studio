$ErrorActionPreference = "SilentlyContinue"

Write-Host "Iniciando limpeza segura do projeto..."

# Pastas para deletar
$targets = @(
    "node_modules",
    "apps/server/node_modules",
    "apps/client/node_modules",
    "dist",
    "apps/server/dist",
    "apps/client/dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".vite",
    ".webpack",
    ".rollup.cache",
    "coverage",
    "tmp",
    "temp",
    "apps/server/temp",
    "apps/client/temp"
)

foreach ($target in $targets) {
    if (Test-Path $target) {
        Write-Host "Removendo pasta: $target"
        Remove-Item -Recurse -Force $target
    }
}

# Arquivos de log e cache
$fileTargets = @(
    "*.log",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    "pnpm-debug.log*",
    ".eslintcache",
    ".stylelintcache",
    ".DS_Store",
    "Thumbs.db"
)

foreach ($ft in $fileTargets) {
    Get-ChildItem -Recurse -Filter $ft | Remove-Item -Force
}

Write-Host "Limpeza concluída com sucesso!"
