param(
    [Parameter(Mandatory = $true)][string]$Video,
    [Parameter(Mandatory = $true)][string]$Audio,
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$SegmentMode,
    [ValidateSet('jaw', 'raw')][string]$ParsingMode = 'jaw',
    [ValidateRange(-20, 20)][int]$BBoxShift = 0,
    [ValidateRange(0, 10)][int]$AudioPaddingLeft = 2,
    [ValidateRange(0, 10)][int]$AudioPaddingRight = 2
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
$lowVramPrepareWsl = Quote-Bash (ConvertTo-WslPath (Join-Path $PSScriptRoot 'prepare-musetalk-low-vram.py'))
$jobKey = [Guid]::NewGuid().ToString('N')
$configJson = @{ job = @{ video_path = $videoWslRaw; audio_path = $audioWslRaw; result_name = 'result.mp4' } } | ConvertTo-Json -Compress
$configEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($configJson))

$linuxTemplate = @'
set -eo pipefail
repo=/root/digital-human-lab/repos/MuseTalk
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
/usr/bin/python3 __LOW_VRAM_PREPARE__ --repo "$repo"
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
  --parsing_mode __PARSING_MODE__ \
  --bbox_shift __BBOX_SHIFT__ \
  --audio_padding_length_left __AUDIO_PADDING_LEFT__ \
  --audio_padding_length_right __AUDIO_PADDING_RIGHT__ \
  --extra_margin 10

result="$work/results/v15/result.mp4"
__VISUAL_COMMAND__
__SYNC_COMMAND__

cp "$result" __OUTPUT__
cp "$work/visual-quality.json" __OUTPUT__.visual-quality.json
cp "$work/syncnet-quality.json" __OUTPUT__.syncnet-quality.json
test -s __OUTPUT__
rm -rf "$work"
'@

$visualCommand = if ($SegmentMode) {
    ".venv/bin/python $visualValidatorWsl --video `"`$result`" --audio '$audioWslRaw' --enforce | tee `"`$work/visual-quality.json`" || test `$? -eq 2"
} else {
    ".venv/bin/python $visualValidatorWsl --video `"`$result`" --audio '$audioWslRaw' --enforce | tee `"`$work/visual-quality.json`""
}
$syncCommand = if ($SegmentMode) {
    ".venv/bin/python $syncValidatorWsl --video `"`$result`" --work-dir `"`$work/syncnet`" --min-confidence 3.0 --max-offset 3 | tee `"`$work/syncnet-quality.json`" || test `$? -eq 2"
} else {
    ".venv/bin/python $syncValidatorWsl --video `"`$result`" --work-dir `"`$work/syncnet`" | tee `"`$work/syncnet-quality.json`""
}
$linuxCommand = $linuxTemplate.Replace('__JOB__', $jobKey).Replace('__CONFIG__', $configEncoded).Replace('__OUTPUT__', $outputWsl).Replace('__LOW_VRAM_PREPARE__', $lowVramPrepareWsl).Replace('__VISUAL_COMMAND__', $visualCommand).Replace('__SYNC_COMMAND__', $syncCommand).Replace('__PARSING_MODE__', $ParsingMode).Replace('__BBOX_SHIFT__', [string]$BBoxShift).Replace('__AUDIO_PADDING_LEFT__', [string]$AudioPaddingLeft).Replace('__AUDIO_PADDING_RIGHT__', [string]$AudioPaddingRight).Replace("`r`n", "`n")
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($linuxCommand))
$wslScript = "/tmp/lingshu-musetalk-$jobKey.sh"
wsl -d Ubuntu-22.04 -u root -- bash -lc "echo '$encodedCommand' | base64 -d > '$wslScript' && chmod 700 '$wslScript' && bash '$wslScript' && rm -f '$wslScript'"
if ($LASTEXITCODE -ne 0) { throw "MuseTalk failed with exit code: $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outputFull -PathType Leaf)) { throw 'MuseTalk did not produce an output video' }

Write-Host "Completed source-motion-preserving avatar: $outputFull"
