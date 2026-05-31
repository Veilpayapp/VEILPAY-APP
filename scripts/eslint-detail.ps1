# Show file-level error breakdown for a single eslint evidence file.
param(
  [Parameter(Mandatory=$true)] [string] $File,
  [int] $Top = 30
)

$p = 'd:\Veilpay\plans\.audit-evidence\' + $File
if (-not (Test-Path $p)) { throw "Missing $p" }
$raw = Get-Content $p -Raw
$start = $raw.IndexOf('[')
$end = $raw.LastIndexOf(']')
$json = $raw.Substring($start, $end - $start + 1)
$arr = $json | ConvertFrom-Json

$rows = $arr |
  Where-Object { $_.errorCount -gt 0 } |
  Sort-Object -Property errorCount -Descending |
  Select-Object -First $Top -Property filePath, errorCount, fatalErrorCount

foreach ($r in $rows) {
  Write-Host ("{0,4} errs ({1} fatal)  {2}" -f $r.errorCount, $r.fatalErrorCount, $r.filePath)
}

Write-Host ""
Write-Host "--- top rules ---"
$rules = @{}
foreach ($entry in $arr) {
  foreach ($m in $entry.messages) {
    if ($m.severity -eq 2) {
      $r = $m.ruleId
      if ([string]::IsNullOrEmpty($r)) { $r = '(parse-error)' }
      if ($rules.ContainsKey($r)) { $rules[$r] = $rules[$r] + 1 } else { $rules[$r] = 1 }
    }
  }
}
$top = $rules.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 10
foreach ($t in $top) { Write-Host ("    {0} = {1}" -f $t.Key, $t.Value) }
