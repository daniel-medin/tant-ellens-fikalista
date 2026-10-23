[CmdletBinding()]
param(
    [string]$HostName = "82.70.47.203",
    [string]$UserName = "ubuntu",
    [string]$KeyPath = "",
    [string]$RemoteAppDir = "/opt/stacks/tantellensfikalista",
    [string]$PublicUrl = "https://tantellensfikalista.mrcheng.se/",
    [switch]$SkipBuildCheck,
    [switch]$SkipPublicVerify
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$PublicUri = [Uri]$PublicUrl
if ($PublicUri.Scheme -ne "https" -or [string]::IsNullOrWhiteSpace($PublicUri.Host)) {
    throw "PublicUrl must be a valid HTTPS URL."
}

if ([string]::IsNullOrWhiteSpace($KeyPath)) {
    $HomeDir = [Environment]::GetEnvironmentVariable("USERPROFILE")
    if ([string]::IsNullOrWhiteSpace($HomeDir)) {
        $HomeDir = [Environment]::GetEnvironmentVariable("HOME")
    }
    if ([string]::IsNullOrWhiteSpace($HomeDir)) {
        throw "Could not determine the home directory. Pass -KeyPath explicitly."
    }
    $KeyPath = Join-Path $HomeDir ".ssh/oracle.key"
}
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "SSH key not found: $KeyPath"
}

$SshTarget = "$UserName@$HostName"
$SshOptions = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new")
$Stamp = Get-Date -Format "yyyyMMddHHmmss"
$ArchiveName = "tantellensfikalista-$Stamp.tar.gz"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "tantellensfikalista-$Stamp"
$StageRoot = Join-Path $TempRoot "stage"
$ArchivePath = Join-Path $TempRoot $ArchiveName

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function ConvertTo-ShellLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + $Value.Replace("'", "'\''") + "'"
}

try {
    if (-not $SkipBuildCheck) {
        Write-Host "Building the app..."
        Push-Location $ProjectRoot
        try {
            Invoke-Native npm "ci"
            Invoke-Native npm "run" "build"
        }
        finally {
            Pop-Location
        }
    }

    $DistPath = Join-Path $ProjectRoot "dist"
    if (-not (Test-Path -LiteralPath $DistPath -PathType Container)) {
        throw "Build output is missing. Run npm run build or omit -SkipBuildCheck."
    }

    $StageSource = Join-Path $StageRoot "src"
    New-Item -ItemType Directory -Path $StageSource -Force | Out-Null
    $StageDist = Join-Path $StageSource "dist"
    $StageServer = Join-Path $StageSource "server"
    New-Item -ItemType Directory -Path $StageDist, $StageServer -Force | Out-Null
    Get-ChildItem -LiteralPath $DistPath -Force | Copy-Item -Destination $StageDist -Recurse
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "server") -Force | Copy-Item -Destination $StageServer -Recurse
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "package.json") -Destination $StageSource
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "package-lock.json") -Destination $StageSource
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "src/Dockerfile") -Destination $StageSource
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "docker-compose.yml") -Destination $StageRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Caddyfile.block") -Destination $StageRoot

    Write-Host "Packaging the production app..."
    Invoke-Native tar "--exclude=.git" "-czf" $ArchivePath "-C" $StageRoot "."
    Invoke-Native scp @SshOptions $ArchivePath "${SshTarget}:/tmp/$ArchiveName"

    $remoteScript = @'
set -euo pipefail
app_dir=__APP_DIR__
archive=__ARCHIVE__
domain=__DOMAIN__
owner=__OWNER__
trap 'rm -f -- "$archive"' EXIT

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi

sudo mkdir -p "$app_dir" /opt/stacks/proxy
sudo chown "$owner:$owner" "$app_dir"
tar -xzf "$archive" -C "$app_dir"
rm -f -- "$archive"

if ! sudo docker network inspect shared_backend >/dev/null 2>&1; then
  sudo docker network create shared_backend >/dev/null
fi

sudo docker compose -f "$app_dir/docker-compose.yml" up -d --build

caddyfile=/opt/stacks/proxy/Caddyfile
if ! sudo grep -Fq $domain $caddyfile; then
  printf '\n' | sudo tee -a "$caddyfile" >/dev/null
  sudo tee -a "$caddyfile" < "$app_dir/Caddyfile.block" >/dev/null
fi

if ! sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile; then
  sudo docker restart caddy
fi

health=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  health="$(sudo docker exec caddy wget -qO- http://tant-ellens-web:8080/api/health || true)"
  if [ "$health" = '{"status":"ok"}' ]; then
    break
  fi
  sleep 2
done
if [ "$health" != '{"status":"ok"}' ]; then
  printf 'App health check failed: %s\n' "$health" >&2
  exit 1
fi
'@

    $remoteCommand = $remoteScript.
        Replace("__APP_DIR__", (ConvertTo-ShellLiteral $RemoteAppDir)).
        Replace("__ARCHIVE__", (ConvertTo-ShellLiteral "/tmp/$ArchiveName")).
        Replace("__DOMAIN__", (ConvertTo-ShellLiteral $PublicUri.Host)).
        Replace("__OWNER__", (ConvertTo-ShellLiteral $UserName))
    $remoteCommand = $remoteCommand -replace "`r", ""

    Write-Host "Deploying to $SshTarget..."
    Invoke-Native ssh @SshOptions $SshTarget $remoteCommand

    if (-not $SkipPublicVerify) {
        Write-Host "Checking $PublicUrl..."
        $HealthUrl = "$($PublicUrl.TrimEnd('/'))/api/health"
        $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 30
        if ($Health.status -ne "ok") {
            throw "Public health check failed: $HealthUrl"
        }
        Write-Host "Public HTTPS health check succeeded."
    }
}
finally {
    if (Test-Path -LiteralPath $TempRoot -PathType Container) {
        Remove-Item -LiteralPath $TempRoot -Recurse -Force
    }
}
