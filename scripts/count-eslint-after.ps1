param([string] $File)
$p = 'd:\Veilpay\.audit-evidence\' + $File
$raw = Get-Content $p -Raw
$start = $raw.IndexOf('[')
$end = $raw.LastIndexOf(']')
if ($start -lt 0 -or $end -lt $start) { Write-Host "$File -> no JSON array"; exit }
$arr = $raw.Substring($start, $end - $start + 1) | ConvertFrom-Json
$errs = ($arr | Measure-Object -Sum errorCount).Sum
$warn = ($arr | Measure-Object -Sum warningCount).Sum
$filesWith = ($arr | Where-Object { $_.errorCount -gt 0 } | Measure-Object).Count
Write-Host ("{0} -> errors={1}, warnings={2}, filesWithErrors={3}" -f $File, $errs, $warn, $filesWith)

# Top 5 worst files
$worst = $arr | Where-Object { $_.errorCount -gt 0 } | Sort-Object -Property errorCount -Descending | Select-Object -First 5
foreach ($w in $worst) {
  Write-Host ("    {0,4} errs  {1}" -f $w.errorCount, $w.filePath)
}
