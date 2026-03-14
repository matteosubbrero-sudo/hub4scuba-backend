param(
  [string] $OutputFile = ".\audits_export.csv",
  [int] $Limit = 500,
  [int] $Skip = 0,
  [int] $ActorHostId = $null,
  [string] $Action = $null,
  [string] $EntityType = $null,
  [string] $Q = $null,
  [string] $From = $null,
  [string] $To = $null,
  [string] $ApiBase = "http://localhost:4000"
)

#Require ADMIN token in env
if (-not $env:ADMIN_TOKEN) {
  Write-Error "ADMIN_TOKEN not set. Export requires an admin Bearer token in $env:ADMIN_TOKEN."
  exit 1
}
$token = $env:ADMIN_TOKEN

#Build query string
$qparams = @()
$qparams += "limit=$Limit"
$qparams += "skip=$Skip"
if ($ActorHostId) { $qparams += "actorHostId=$ActorHostId" }
if ($Action) { $qparams += "action=$([System.Web.HttpUtility]::UrlEncode($Action))" }
if ($EntityType) { $qparams += "entityType=$([System.Web.HttpUtility]::UrlEncode($EntityType))" }
if ($Q) { $qparams += "q=$([System.Web.HttpUtility]::UrlEncode($Q))" }
if ($From) { $qparams += "from=$([System.Web.HttpUtility]::UrlEncode($From))" }
if ($To) { $qparams += "to=$([System.Web.HttpUtility]::UrlEncode($To))" }

$uri = "$ApiBase/admin/audits?" + ($qparams -join "&")
Write-Host "Fetching:" $uri

#Call API
try {
  $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "Bearer $token" } -ErrorAction Stop
} catch {
  Write-Error "API request failed: $($_.Exception.Message)"
  exit 2
}
if (-not $resp.items) {
  Write-Host "No items returned."
  exit 0
}

#Build rows: extract common meta keys (email, experienceId, userEmail, userName)
$rows = $resp.items | ForEach-Object {

#raw meta may be string (JSON) or object
  $metaRaw = $_.meta
  $metaObj = $null
  if ($metaRaw -is [string]) {
    try { $metaObj = ConvertFrom-Json $metaRaw -ErrorAction Stop } catch { $metaObj = $null }
  } else {
    $metaObj = $metaRaw
  }

#initialize extracted fields
  $email = $null
  $experienceId = $null
  $userEmail = $null
  $userName = $null

  if ($metaObj) {
    if ($metaObj.PSObject.Properties.Name -contains 'email') { $email = $metaObj.email }
    if ($metaObj.PSObject.Properties.Name -contains 'experienceId') { $experienceId = $metaObj.experienceId }
    if ($metaObj.PSObject.Properties.Name -contains 'userEmail') { $userEmail = $metaObj.userEmail }
    if ($metaObj.PSObject.Properties.Name -contains 'userName') { $userName = $metaObj.userName }
    if (-not $email -and $metaObj.query -and $metaObj.query.email) { $email = $metaObj.query.email }
    if (-not $userEmail -and $metaObj.query -and $metaObj.query.userEmail) { $userEmail = $metaObj.query.userEmail }
    if (-not $userName -and $metaObj.query -and $metaObj.query.userName) { $userName = $metaObj.query.userName }
  }

#meta as string for CSV
  if ($metaRaw -isnot [string]) {
    try { $metaVal = ConvertTo-Json $metaRaw -Compress } catch { $metaVal = "$metaRaw" }
  } else {
    $metaVal = $metaRaw
  }

  [PSCustomObject]@{
    id = $_.id
 createdAt = $_.createdAt
 actorHostId = $_.actorHostId
 action = $_.action
 entityType = $_.entityType
 entityId = $_.entityId
    email = $email
    experienceId = $experienceId
    userEmail = $userEmail
    userName = $userName
    meta = $metaVal
  }
}

#Export to CSV
$rows | Export-Csv -Path $OutputFile -NoTypeInformation -Encoding UTF8
Write-Host "Exported" ($rows.Count) "rows to" $OutputFile