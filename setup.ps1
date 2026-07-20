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

$setupScript = Join-Path $PSScriptRoot "scripts\docker-setup.ps1"
& $setupScript @PSBoundParameters
