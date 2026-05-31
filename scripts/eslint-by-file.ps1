# Show actual eslint messages for files matching a substring.
param(
  [Parameter(Mandatory=$true)] [string] $File,
  [Parameter(Mandatory=$true)] [string] $Match
)

$p = 'd:\Veilpay\plans\.audit-evidence\' + $File
$raw = Get-Content $p -Raw
$start = $raw.IndexOf('[')
$end = $raw.LastIndexOf(']')
$json = $raw.Substring($start, $end - $start + 1)
$arr = $json | ConvertFrom-Json

foreach ($entry in $arr) {
  if (-not $entry.filePath.Contains($Match)) { continue }
  Write-Host ""
  Write-Host "=== $($entry.filePath) ==="
  foreach ($m in $entry.messages) {
    if ($m.severity -ne 2) { continue }
    Write-Host ("  L{0}:{1}  {2}  {3}" -f $m.line, $m.column, $m.ruleId, $m.message)
  }
}
