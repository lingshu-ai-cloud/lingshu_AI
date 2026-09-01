param(
    [Parameter(Mandatory = $true)][string]$Video,
    [Parameter(Mandatory = $true)][string]$Audio,
    [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'

foreach ($inputPath in @($Video, $Audio)) {
    if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
        throw "Input file not found: $inputPath"
    }
}

function ConvertTo-WslPath([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $drive = $fullPath.Substring(0, 1).ToLowerInvariant()
    return "/mnt/$drive/" + $fullPath.Substring(3).Replace('\', '/')
}

function Quote-Bash([string]$Value) {
    if ($Value.Contains("'")) { throw 'Input path cannot contain a single quote' }
    return "'" + $Value + "'"
}

$videoPath = (Resolve-Path -LiteralPath $Video).Path
$audioPath = (Resolve-Path -LiteralPath $Audio).Path
$videoWslRaw = ConvertTo-WslPath $videoPath
$audioWslRaw = ConvertTo-WslPath $audioPath
$outputFull = [IO.Path]::GetFullPath($Output)
$outputDir = Split-Path -Parent $outputFull
if ($outputDir) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$outputWsl = Quote-Bash (ConvertTo-WslPath $outputFull)
$visualValidatorWsl = Quote-Bash (ConvertTo-WslPath (Join-Path $PSScriptRoot 'validate-digital-human.py'))
$syncValidatorWsl = Quote-Bash (ConvertTo-WslPath (Join-Path $PSScriptRoot 'validate-syncnet.py'))
$jobKey = [Guid]::NewGuid().ToString('N')
$configJson = @{ job = @{ video_path = $videoWslRaw; audio_path = $audioWslRaw; result_name = 'result.mp4' } } | ConvertTo-Json -Compress
$configEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($configJson))

$linuxTemplate = @'
set -eo pipefail
repo=/root/digital-human-lab/repos/MuseTalk
work=/root/digital-human-lab/outputs/musetalk-worker/__JOB__
rm -rf "$work"
mkdir -p "$work/results"
echo '__CONFIG__' | base64 -d > "$work/inference.json"

cd "$repo"
PYTHONPATH=. .venv/bin/python scripts/inference.py \
  --inference_config "$work/inference.json" \
  --result_dir "$work/results" \
  --unet_config ./models/musetalkV15/musetalk.json \
  --unet_model_path ./models/musetalkV15/unet.pth \
  --whisper_dir ./models/whisper \
  --version v15 \
  --use_float16 \
  --batch_size 2 \
  --parsing_mode jaw \
  --extra_margin 10

result="$work/results/v15/result.mp4"
.venv/bin/python __VISUAL_VALIDATOR__ --video "$result" --audio '__AUDIO__' --enforce | tee "$work/visual-quality.json"
.venv/bin/python __SYNC_VALIDATOR__ --video "$result" --work-dir "$work/syncnet" | tee "$work/syncnet-quality.json"

cp "$result" __OUTPUT__
cp "$work/visual-quality.json" __OUTPUT__.visual-quality.json
cp "$work/syncnet-quality.json" __OUTPUT__.syncnet-quality.json
test -s __OUTPUT__
rm -rf "$work"
'@

$linuxCommand = $linuxTemplate.Replace('__JOB__', $jobKey).Replace('__CONFIG__', $configEncoded).Replace('__OUTPUT__', $outputWsl).Replace('__AUDIO__', $audioWslRaw).Replace('__VISUAL_VALIDATOR__', $visualValidatorWsl).Replace('__SYNC_VALIDATOR__', $syncValidatorWsl).Replace("`r`n", "`n")
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($linuxCommand))
$wslScript = "/tmp/lingshu-musetalk-$jobKey.sh"
wsl -d Ubuntu-22.04 -u root -- bash -lc "echo '$encodedCommand' | base64 -d > '$wslScript' && chmod 700 '$wslScript' && bash '$wslScript' && rm -f '$wslScript'"
if ($LASTEXITCODE -ne 0) { throw "MuseTalk failed with exit code: $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outputFull -PathType Leaf)) { throw 'MuseTalk did not produce an output video' }

Write-Host "Completed source-motion-preserving avatar: $outputFull"
