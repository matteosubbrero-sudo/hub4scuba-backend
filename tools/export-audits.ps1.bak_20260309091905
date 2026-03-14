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

if (-not $env:ADMIN_TOKEN) {
  Write-Error "ADMIN_TOKEN not set. Export requires an admin Bearer token in $env:ADMIN_TOKEN."
  exit 1
}

$token = $env:ADMIN_TOKEN

#build query string
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

#select fields to export; meta left as JSON string
$rows = $resp.items | ForEach-Object {
  $metaVal = $_.meta
  if ($metaVal -isnot [string]) {
 try { $metaVal = (ConvertTo-Json $metaVal -Compress) } catch { $metaVal = "$metaVal" }
  }
  [PSCustomObject]@{
 id = $_.id
 createdAt = $_.createdAt
 actorHostId = $_.actorHostId
 action = $_.action
 entityType = $_.entityType
 entityId = $_.entityId
 meta = $metaVal
  }
}
$rows | Export-Csv -Path $OutputFile -NoTypeInformation -Encoding UTF8
Write-Host "Exported" ($rows.Count) "rows to" $OutputFile
