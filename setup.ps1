# ============================================================================= 
#  Food Ordering App - one-time setup script (Windows / PowerShell) 
# 
#  What it does: 
#    1. Checks for Node.js; installs it via winget if missing. 
#    2. Runs "npm install" to fetch all project dependencies. 
#    3. Creates a .env file from .env.example if you don't have one. 
# 
#  How to run (from this folder): 
#    Right-click > "Run with PowerShell" 
#      -- OR -- 
#    Open PowerShell here and run: 
#        powershell -ExecutionPolicy Bypass -File .\setup.ps1 
# ============================================================================= 
 
$ErrorActionPreference = 'Stop' 
Set-Location -Path $PSScriptRoot 
 
function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan } 
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green } 
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow } 
 
# Reload PATH from Machine + User scopes (so a freshly installed tool is found 
# without opening a new terminal). 
function Update-Path { 
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') 
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User') 
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';' 
} 
 
# --------------------------------------------------------------------------- 
# 1. Node.js 
# --------------------------------------------------------------------------- 
Write-Step "Checking for Node.js" 
 
if (Get-Command node -ErrorAction SilentlyContinue) { 
    Write-Ok ("Node.js found: " + (node -v)) 
} 
else { 
    Write-Warn "Node.js not found. Attempting to install via winget..." 
 
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { 
        Write-Host "" 
        Write-Host "  winget is not available on this system." -ForegroundColor Red 
        Write-Host "  Please install Node.js (LTS) manually from https://nodejs.org" -ForegroundColor Red 
        Write-Host "  then run this script again." -ForegroundColor Red 
        exit 1 
    } 
 
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements 
    Update-Path 
 
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { 
        Write-Host "" 
        Write-Host "  Node.js was installed but is not on PATH in this session." -ForegroundColor Yellow 
        Write-Host "  Close this window, open a NEW PowerShell here, and run setup.ps1 again." -ForegroundColor Yellow 
        exit 1 
    } 
    Write-Ok ("Node.js installed: " + (node -v)) 
} 
 
# --------------------------------------------------------------------------- 
# 2. Dependencies 
# --------------------------------------------------------------------------- 
Write-Step "Installing project dependencies (npm install)" 
npm install 
if ($LASTEXITCODE -ne 0) { 
    Write-Host "    npm install failed. See the error above." -ForegroundColor Red 
    exit 1 
} 
Write-Ok "Dependencies installed." 
 
# --------------------------------------------------------------------------- 
# 3. .env config 
# --------------------------------------------------------------------------- 
Write-Step "Setting up configuration (.env)" 
if (Test-Path ".\.env") { 
    Write-Ok ".env already exists - leaving it untouched." 
} 
else { 
    Copy-Item ".\.env.example" ".\.env" 
    Write-Ok "Created .env from .env.example." 
    Write-Warn "Remember to change JWT_SECRET and ADMIN_PASSWORD in .env before going live." 
} 
 
# --------------------------------------------------------------------------- 
# Done 
# --------------------------------------------------------------------------- 
Write-Host "`n============================================================" -ForegroundColor Green 
Write-Host "  Setup complete!" -ForegroundColor Green 
Write-Host "  Start the app with:   npm start" -ForegroundColor Green 
Write-Host "" 
Write-Host "  Customer app : http://localhost:3000/" 
Write-Host "  Owner login  : http://localhost:3000/owner.html" 
Write-Host "  Admin panel  : http://localhost:3000/admin.html" 
Write-Host "============================================================`n" -ForegroundColor Green 
 

 
