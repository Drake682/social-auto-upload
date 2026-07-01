$ErrorActionPreference = "Stop"

$dispatchUrl = $env:FLASK_DISPATCH_URL
if ([string]::IsNullOrWhiteSpace($dispatchUrl)) {
    $dispatchUrl = "http://127.0.0.1:5000/uploader/dispatch"
}

$cookieJson = $env:FACEBOOK_COOKIE_JSON
if ([string]::IsNullOrWhiteSpace($cookieJson) -and -not [string]::IsNullOrWhiteSpace($env:FACEBOOK_COOKIE_FILE)) {
    $cookieJson = Get-Content -Path $env:FACEBOOK_COOKIE_FILE -Raw -Encoding UTF8
}
if ([string]::IsNullOrWhiteSpace($cookieJson)) {
    throw "Set FACEBOOK_COOKIE_JSON or FACEBOOK_COOKIE_FILE before running this script."
}

$videoUrl = $env:PLAYWRIGHT_E2E_VIDEO_URL
if ([string]::IsNullOrWhiteSpace($videoUrl)) {
    $videoUrl = "s3://socialflow-media/tenants/1/raw/input.mp4"
}

$jobSuffix = "{0}-{1}" -f (Get-Date -Format "yyyyMMddHHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
$jobId = "proxy-test-$jobSuffix"

$payload = @{
    job_id = $jobId
    tenant_id = 1
    user_id = 1
    platform = "facebook"
    video_url = $videoUrl
    caption = "Phase 14 proxy routing test"
    proxy = ""
    account_cookie = $cookieJson
} | ConvertTo-Json -Depth 20

Write-Host "[DISPATCH] POST $dispatchUrl"
$response = Invoke-RestMethod -Method Post -Uri $dispatchUrl -ContentType "application/json" -Body $payload -TimeoutSec 15
$response | ConvertTo-Json -Depth 20
