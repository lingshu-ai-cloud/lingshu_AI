param(
    [string]$ProductionDir = (Join-Path $PSScriptRoot '..\data\digital-human-v2\production'),
    [string]$SourceDir = (Join-Path $PSScriptRoot '..\data\digital-human-v2\source'),
    [string]$Output = (Join-Path $PSScriptRoot '..\data\digital-human-v2\production\数字人V2-房地产15秒-内部技术演示.mp4')
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ffmpeg = Join-Path $root 'node_modules\ffmpeg-static\ffmpeg.exe'
$font = 'C\:/Windows/Fonts/msyh.ttc'
$beat1 = Join-Path $ProductionDir 'musetalk-beat-1.mp4'
$beat2 = Join-Path $ProductionDir 'musetalk-beat-2.mp4'
$beat3 = Join-Path $ProductionDir 'musetalk-beat-3.mp4'
$living = Join-Path $SourceDir 'pexels-living-room-7749263.mp4'
$city = Join-Path $SourceDir 'pexels-city-view-8572185.mp4'
foreach ($file in @($ffmpeg, $beat1, $beat2, $beat3, $living, $city)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing input: $file" }
}

$outputFull = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFull) | Out-Null
$filter = @"
[0:v]scale=1120:1992:flags=lanczos,crop=1080:1920:(iw-ow)/2:(ih-oh)/2,drawbox=x=36:y=54:w=1008:h=112:color=black@0.52:t=fill,drawtext=fontfile='$font':text='买房，别只看总价':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=78,drawbox=x=28:y=1638:w=1024:h=178:color=black@0.58:t=fill,drawtext=fontfile='$font':text='真正决定居住体验的\n是通勤、配套和户型':fontcolor=white:fontsize=45:line_spacing=14:x=(w-text_w)/2:y=1670,drawtext=fontfile='$font':text='内部技术演示 · 素材人物不构成项目代言':fontcolor=white@0.72:fontsize=23:x=(w-text_w)/2:y=1870,setsar=1[v0];
[1:v]trim=duration=5.119,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=5,eq=brightness=-0.18:saturation=0.85[bg1];[2:v]scale=820:1458:flags=lanczos[fg1];[bg1]drawbox=x=110:y=286:w=860:h=1538:color=white@0.92:t=fill[b1];[b1][fg1]overlay=130:326:shortest=1,drawbox=x=40:y=62:w=1000:h=150:color=black@0.62:t=fill,drawtext=fontfile='$font':text='步行可达地铁 · 商业配套齐全':fontcolor=white:fontsize=47:x=(w-text_w)/2:y=105,drawbox=x=74:y=1608:w=932:h=176:color=#0f5132@0.88:t=fill,drawtext=fontfile='$font':text='南向三房  采光通透':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=1658,drawtext=fontfile='$font':text='内部技术演示':fontcolor=white@0.75:fontsize=23:x=(w-text_w)/2:y=1870,setsar=1[v1];
[3:v]trim=duration=4.735,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.30:saturation=0.82[bg2];[4:v]scale=790:1404:flags=lanczos[fg2];[bg2]drawbox=x=18:y=332:w=830:h=1444:color=white@0.92:t=fill[b2];[b2][fg2]overlay=38:352:shortest=1,drawbox=x=55:y=68:w=970:h=220:color=#082f49@0.91:t=fill,drawtext=fontfile='$font':text='领取最新房源\n和价格对比':fontcolor=white:fontsize=62:line_spacing=14:x=108:y=102,drawbox=x=690:y=1510:w=330:h=200:color=#16a34a@0.94:t=fill,drawtext=fontfile='$font':text='现在私信':fontcolor=white:fontsize=47:x=753:y=1574,drawtext=fontfile='$font':text='内部技术演示 · 非真实楼盘承诺':fontcolor=white@0.76:fontsize=23:x=(w-text_w)/2:y=1870,setsar=1[v2];
[v0][0:a][v1][2:a][v2][4:a]concat=n=3:v=1:a=1[v][a]
"@.Replace("`r", '').Replace("`n", '')

& $ffmpeg -y -hide_banner -loglevel error `
  -i $beat1 -stream_loop -1 -i $living -i $beat2 -stream_loop -1 -i $city -i $beat3 `
  -filter_complex $filter -map '[v]' -map '[a]' -r 25 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p `
  -c:a aac -b:a 160k -ar 48000 -movflags +faststart $outputFull
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputFull)) { throw 'V2 demo rendering failed' }
Write-Host "Rendered: $outputFull"
