# Licensing Bro's voice connector for Windows.
# Connects VoiceStudio on this PC to Licensing Bro's so students hear your voice:
#   1. finds VoiceStudio's voices on this PC and picks your cloned voice,
#   2. checks whether VoiceStudio can also transcribe (for clear-voice listening),
#   3. starts a free Cloudflare tunnel so the cloud can reach VoiceStudio (downloads cloudflared if needed),
#   4. sends the tunnel address to Licensing Bro's and switches Bro's studio voice on,
#   5. keeps the tunnel running, and reconnects with the new address if it ever restarts.
# Keep this window open (minimized is fine). Closing it disconnects the voice; students then hear the phone's voice.
# Run it from Admin > Settings > Bro's voice, which gives you the command with your connect code filled in.

param(
  [string]$Code,
  [string]$Supabase,
  [string]$Anon,
  [int]$Port = 3900,
  [string]$Voice
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Join-Path $env:LOCALAPPDATA "BroVoice"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$ConfigFile = Join-Path $Dir "config.json"

function Say([string]$msg, [string]$color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Stamp { (Get-Date).ToString("h:mm tt") }

Write-Host ""
Say "  Licensing Bro's voice connector" Cyan
Say "  Keep this window open while you want students to hear your voice." DarkGray
Write-Host ""

# ---------------------------------------------------------------- settings (remembered for next time)
$cfg = @{}
if (Test-Path $ConfigFile) {
  try { (Get-Content $ConfigFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } } catch { }
}
if ($Code) { $cfg.code = $Code }
if ($Supabase) { $cfg.supabase = $Supabase.TrimEnd("/") }
if ($Anon) { $cfg.anon = $Anon }
if ($Voice) { $cfg.voice = $Voice }
if (-not $cfg.code -or -not $cfg.supabase -or -not $cfg.anon) {
  Say "Missing the connect code. Copy the command from Admin > Settings > Bro's voice and run that instead." Red
  Read-Host "Press Enter to close" | Out-Null
  exit 1
}
function Save-Config { $cfg | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding ASCII }
Save-Config

# ---------------------------------------------------------------- 1. VoiceStudio and the voice to use
$local = "http://127.0.0.1:$Port"
$voices = $null
$waited = 0
while (-not $voices) {
  try { $voices = Invoke-RestMethod -Uri "$local/v1/audio/voices" -TimeoutSec 5 }
  catch {
    if ($waited % 30 -eq 0) { Say "[$(Stamp)] Waiting for VoiceStudio on port $Port. Open the VoiceStudio app if it isn't open." Yellow }
    Start-Sleep -Seconds 3; $waited += 3
  }
}
$list = @()
if ($voices.voices) { $list = @($voices.voices) } elseif ($voices.data) { $list = @($voices.data) } elseif ($voices -is [array]) { $list = @($voices) }
$profiles = @($list | Where-Object { $_.type -eq "profile" -or $_.kind -eq "profile" })
function VoiceId($v) { if ($v.voice_id) { $v.voice_id } elseif ($v.id) { $v.id } else { $v.name } }
function VoiceName($v) { if ($v.name) { $v.name } else { VoiceId $v } }

$chosen = $cfg.voice
if ($chosen -and -not ($profiles | Where-Object { (VoiceId $_) -eq $chosen }) -and $profiles.Count -gt 0) { $chosen = $null }
# The school's voice is the one saved in VoiceStudio as "Bro": use it whenever it exists
$bro = @($profiles | Where-Object { "$(VoiceName $_)".Trim() -ieq "bro" }) | Select-Object -First 1
if ($bro -and -not $Voice) { $chosen = VoiceId $bro }
if (-not $chosen) {
  if ($profiles.Count -eq 0) {
    Say "No saved voice found in VoiceStudio yet, so Bro will use VoiceStudio's standard voice." Yellow
    Say "Save your voice in VoiceStudio with the name Bro, then run this again to switch to it." Yellow
    $chosen = "alloy"
  } elseif ($profiles.Count -eq 1) {
    $chosen = VoiceId $profiles[0]
  } else {
    Say "Which voice should Bro use?" White
    for ($i = 0; $i -lt $profiles.Count; $i++) { Say ("  {0}. {1}  ({2})" -f ($i + 1), (VoiceName $profiles[$i]), (VoiceId $profiles[$i])) White }
    $pick = 0
    while ($pick -lt 1 -or $pick -gt $profiles.Count) { [int]::TryParse((Read-Host "Type a number"), [ref]$pick) | Out-Null }
    $chosen = VoiceId $profiles[$pick - 1]
  }
}
$cfg.voice = $chosen; Save-Config
$label = $chosen
$match = @($profiles | Where-Object { (VoiceId $_) -eq $chosen }) | Select-Object -First 1
if ($match) { $label = "$(VoiceName $match) ($chosen)" }
Say "[$(Stamp)] VoiceStudio is running. Bro's voice: $label" Green

# ---------------------------------------------------------------- 2. Can VoiceStudio transcribe? (clear-voice listening)
$stt = $false
try {
  Add-Type -AssemblyName System.Net.Http
  # One second of silence as a 16 kHz mono WAV
  $rate = 16000; $samples = $rate; $dataLen = $samples * 2
  $ms = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter($ms)
  $w.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $w.Write([int](36 + $dataLen)); $w.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
  $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1); $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
  $w.Write([Text.Encoding]::ASCII.GetBytes("data")); $w.Write([int]$dataLen); $w.Write((New-Object byte[] $dataLen)); $w.Flush()
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromSeconds(60)
  $form = New-Object System.Net.Http.MultipartFormDataContent
  $file = New-Object System.Net.Http.ByteArrayContent -ArgumentList (, $ms.ToArray())
  $file.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("audio/wav")
  $form.Add($file, '"file"', '"check.wav"')
  $form.Add((New-Object System.Net.Http.StringContent("whisper-1")), '"model"')
  $res = $client.PostAsync("$local/v1/audio/transcriptions", $form).Result
  $stt = $res.IsSuccessStatusCode
} catch { $stt = $false }
if ($stt) { Say "[$(Stamp)] VoiceStudio can also transcribe: clear-voice listening will be on." Green }
else { Say "[$(Stamp)] VoiceStudio's transcription isn't available, so students' phones will keep doing the listening." DarkYellow }

# ---------------------------------------------------------------- 3. Cloudflare tunnel
$cf = $null
$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cmd) { $cf = $cmd.Source }
foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", (Join-Path $Dir "cloudflared.exe"))) {
  if (-not $cf -and $p -and (Test-Path $p)) { $cf = $p }
}
if (-not $cf) {
  Say "[$(Stamp)] Downloading Cloudflare Tunnel (free, about 60 MB)..." White
  $cf = Join-Path $Dir "cloudflared.exe"
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "x86") { "386" } else { "amd64" }
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe" -OutFile $cf -UseBasicParsing
}

# ---------------------------------------------------------------- 4 and 5. Connect, then keep it connected
$offerStartup = -not $cfg.startupAsked
while ($true) {
  $log = Join-Path $Dir "tunnel.log"
  Remove-Item $log -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $cf -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:$Port") -RedirectStandardError $log -RedirectStandardOutput (Join-Path $Dir "tunnel.out") -NoNewWindow -PassThru
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url -and -not $proc.HasExited; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if (-not $url) {
    Say "[$(Stamp)] The tunnel didn't start. Trying again in 20 seconds..." Yellow
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
    Start-Sleep -Seconds 20
    continue
  }
  # The new address takes a few seconds to work everywhere
  for ($i = 0; $i -lt 20; $i++) { try { Invoke-RestMethod -Uri "$url/v1/audio/voices" -TimeoutSec 8 | Out-Null; break } catch { Start-Sleep -Seconds 2 } }

  $body = @{ code = $cfg.code; url = $url; voice = $cfg.voice; stt = $stt; machine = $env:COMPUTERNAME } | ConvertTo-Json
  $connected = $false
  for ($try = 1; $try -le 5 -and -not $connected; $try++) {
    try {
      $r = Invoke-RestMethod -Uri "$($cfg.supabase)/functions/v1/voice-connect" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60 -Headers @{ apikey = $cfg.anon; Authorization = "Bearer $($cfg.anon)" }
      $connected = $true
    } catch {
      $msg = $_.Exception.Message
      try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
      if ($msg -match "connect code") {
        Say "[$(Stamp)] $msg" Red
        Remove-Item $ConfigFile -ErrorAction SilentlyContinue
        try { $proc.Kill() } catch { }
        Read-Host "Press Enter to close" | Out-Null
        exit 1
      }
      Say "[$(Stamp)] Couldn't reach Licensing Bro's yet ($msg). Trying again..." Yellow
      Start-Sleep -Seconds (10 * $try)
    }
  }
  if ($connected) {
    Write-Host ""
    Say "[$(Stamp)] Connected! Students now hear Bro in your voice." Green
    Say "           Tunnel: $url" DarkGray
    Say "           Leave this window open (you can minimize it)." DarkGray
    Write-Host ""
    if ($offerStartup) {
      $offerStartup = $false
      $cfg.startupAsked = $true; Save-Config
      $ans = Read-Host "Start this automatically when you sign in to Windows? (Y/N)"
      if ($ans -match "^[Yy]") {
        $self = Join-Path $Dir "bro-voice.ps1"
        if ($PSCommandPath -and ($PSCommandPath -ne $self)) { Copy-Item -Path $PSCommandPath -Destination $self -Force }
        $startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Licensing Bros voice.cmd"
        Set-Content -Path $startup -Encoding ASCII -Value "@echo off`r`nstart `"Licensing Bro's voice`" /min powershell -NoProfile -ExecutionPolicy Bypass -File `"$self`""
        Say "Done. It will start (minimized) whenever you sign in. VoiceStudio needs to open at sign-in too." Green
      }
    }
  }
  $proc.WaitForExit()
  Say "[$(Stamp)] The tunnel stopped. Reconnecting..." Yellow
  Start-Sleep -Seconds 3
}
