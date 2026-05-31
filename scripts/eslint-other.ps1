# Show eslint errors that are NOT no-unnecessary-type-assertion or require-await.
param(
  [Parameter(Mandatory=$true)] [string] $File
)

$p = 'd:\Veilpay\plans\.audit-evidence\' + $File
$raw = Get-Content $p -Raw
$start = $raw.IndexOf('[')
$end = $raw.LastIndexOf(']')
$json = $raw.Substring($start, $end - $start + 1)
$arr = $json | ConvertFrom-Json

$skip = @(
  '@typescript-eslint/no-unnecessary-type-assertion',
  '@typescript-eslint/require-await'
)

foreach ($entry in $arr) {
  $relevant = $entry.messages | Where-Object {
    $_.severity -eq 2 -and ($skip -notcontains $_.ruleId)
  }
  if (-not $relevant) { continue }
  Write-Host ""
  Write-Host "=== $($entry.filePath) ==="
  foreach ($m in $relevant) {
    Write-Host ("  L{0}:{1}  {2}  {3}" -f $m.line, $m.column, $m.ruleId, $m.message)
  }
}
