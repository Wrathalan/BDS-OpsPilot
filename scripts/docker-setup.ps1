[CmdletBinding()]
param(
    [string] $HostAddress,
    [ValidateRange(1, 65535)]
    [int] $Port = 3000,
    [string] $PublicUrl,
    [string] $EnvFile = ".env",
    [ValidateRange(30, 3600)]
    [int] $WaitTimeoutSeconds = 900,
    [switch] $ConfigOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    [System.IO.Path]::GetFullPath($EnvFile)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $EnvFile))
}
$EnvWasCreated = -not (Test-Path -LiteralPath $EnvPath)
$HostWasExplicit = $PSBoundParameters.ContainsKey("HostAddress")
$PortWasExplicit = $PSBoundParameters.ContainsKey("Port")
$PublicUrlWasExplicit = $PSBoundParameters.ContainsKey("PublicUrl")

function New-HexSecret {
    param([int] $ByteCount)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Get-PreferredLanAddress {
    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($networkInterface in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($networkInterface.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
            continue
        }
        if ($networkInterface.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) {
            continue
        }

        foreach ($address in $networkInterface.GetIPProperties().UnicastAddresses) {
            if ($address.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
                continue
            }

            $value = $address.Address.ToString()
            if ($value -notmatch '^(127\.|169\.254\.)') {
                $candidates.Add($value)
            }
        }
    }

    $private = $candidates | Where-Object {
        $_ -match '^10\.' -or $_ -match '^192\.168\.' -or $_ -match '^172\.(1[6-9]|2[0-9]|3[01])\.'
    } | Select-Object -First 1

    if ($private) { return $private }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return "127.0.0.1"
}

function Get-DotEnvValue {
    param([string] $Path, [string] $Name)

    $pattern = '^\s*' + [System.Text.RegularExpressions.Regex]::Escape($Name) + '\s*=\s*(.*)\s*$'
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }

    return $null
}

function Set-DotEnvValue {
    param([string] $Path, [string] $Name, [string] $Value)

    $pattern = '^\s*' + [System.Text.RegularExpressions.Regex]::Escape($Name) + '\s*='
    $found = $false
    $updated = foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            $found = $true
            '{0}="{1}"' -f $Name, $Value
        } else {
            $line
        }
    }

    if (-not $found) {
        $updated = @($updated) + ('{0}="{1}"' -f $Name, $Value)
    }

    [System.IO.File]::WriteAllLines(
        $Path,
        [string[]] $updated,
        [System.Text.UTF8Encoding]::new($false)
    )
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or is not available on PATH."
}

Push-Location $RepoRoot
try {
    & docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is installed, but the Docker daemon is not available."
    }

    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is required."
    }

    if ($EnvWasCreated) {
        Copy-Item -LiteralPath (Join-Path $RepoRoot ".env.example") -Destination $EnvPath
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "backups") | Out-Null

    $generatedPassword = $null
    $sessionSecret = Get-DotEnvValue -Path $EnvPath -Name "SESSION_SECRET"
    if ([string]::IsNullOrWhiteSpace($sessionSecret) -or $sessionSecret -eq "replace-with-at-least-32-random-characters") {
        Set-DotEnvValue -Path $EnvPath -Name "SESSION_SECRET" -Value (New-HexSecret -ByteCount 32)
    }

    $adminPassword = Get-DotEnvValue -Path $EnvPath -Name "BOOTSTRAP_ADMIN_PASSWORD"
    if ([string]::IsNullOrWhiteSpace($adminPassword) -or $adminPassword.Length -lt 12 -or @("Ethic0n1", "change-this-before-starting") -contains $adminPassword) {
        $generatedPassword = New-HexSecret -ByteCount 16
        Set-DotEnvValue -Path $EnvPath -Name "BOOTSTRAP_ADMIN_PASSWORD" -Value $generatedPassword
    }

    if ($EnvWasCreated -or $HostWasExplicit -or $PortWasExplicit -or $PublicUrlWasExplicit) {
        if ([string]::IsNullOrWhiteSpace($HostAddress)) {
            $HostAddress = Get-PreferredLanAddress
        }
        if ($HostAddress -notmatch '^[A-Za-z0-9.-]+$') {
            throw "HostAddress must be an IPv4 address or DNS host name."
        }

        Set-DotEnvValue -Path $EnvPath -Name "OPSPILOT_PORT" -Value $Port.ToString()
        $controlPlaneUrl = "http://${HostAddress}:$Port"
        if ($PublicUrlWasExplicit) {
            $parsedPublicUrl = $null
            if (-not [System.Uri]::TryCreate($PublicUrl, [System.UriKind]::Absolute, [ref]$parsedPublicUrl) -or $parsedPublicUrl.Scheme -ne "https" -or $parsedPublicUrl.UserInfo) {
                throw "PublicUrl must be an absolute HTTPS URL without embedded credentials."
            }
            $controlPlaneUrl = $PublicUrl.TrimEnd("/")
        }
        Set-DotEnvValue -Path $EnvPath -Name "APP_URL" -Value $controlPlaneUrl
        Set-DotEnvValue -Path $EnvPath -Name "AGENT_SERVER_URL" -Value $controlPlaneUrl
        Set-DotEnvValue -Path $EnvPath -Name "SESSION_COOKIE_SECURE" -Value $(if ($controlPlaneUrl.StartsWith("https://")) { "true" } else { "false" })
        Set-DotEnvValue -Path $EnvPath -Name "ALLOW_INSECURE_HTTP" -Value $(if ($controlPlaneUrl.StartsWith("https://") -or $HostAddress -in @("127.0.0.1", "localhost", "::1")) { "0" } else { "1" })
        Set-DotEnvValue -Path $EnvPath -Name "RUSTDESK_ID_SERVER" -Value "${HostAddress}:21116"
        Set-DotEnvValue -Path $EnvPath -Name "RUSTDESK_RELAY_SERVER" -Value "${HostAddress}:21117"
    }

    & docker compose --env-file $EnvPath config --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose configuration validation failed."
    }

    if ($ConfigOnly) {
        Write-Host "Docker configuration is valid: $EnvPath"
        exit 0
    }

    & docker compose --env-file $EnvPath up --build --detach --remove-orphans --wait --wait-timeout $WaitTimeoutSeconds
    if ($LASTEXITCODE -ne 0) {
        throw "Docker deployment did not become healthy within $WaitTimeoutSeconds seconds."
    }

    & docker compose --env-file $EnvPath exec -T --user node opspilot node scripts/create-backup.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker deployment became healthy, but its verified backup failed."
    }

    & docker compose --env-file $EnvPath ps

    $appUrl = Get-DotEnvValue -Path $EnvPath -Name "APP_URL"
    $adminUsername = Get-DotEnvValue -Path $EnvPath -Name "BOOTSTRAP_ADMIN_USERNAME"
    Write-Host ""
    Write-Host "OpsPilot is ready: $appUrl"
    Write-Host "Administrator: $adminUsername"
    if ($generatedPassword) {
        Write-Host "Generated password: $generatedPassword"
        Write-Host "The password is stored only in $EnvPath."
    } else {
        Write-Host "Existing administrator credentials were retained from $EnvPath."
    }
} finally {
    Pop-Location
}
