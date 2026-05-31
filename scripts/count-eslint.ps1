$files = @(
  'eslint.veilpay__backend.json',
  'eslint.veilpay__frontend.json',
  'eslint.consumer-app.json',
  'eslint.veilpay__indexer.json',
  'eslint.veilpay__shared.json',
  'eslint.veilpay__circuits.json',
  'eslint.veilpay__contracts-aptos.json',
  'eslint.veilpay__contracts-evm.json',
  'eslint.veilpay__contracts-solana.json',
  'eslint.veilpay__auditor.json',
  'eslint.antigravity-awesome-skills.json'
)

foreach ($f in $files) {
  $p = 'd:\Veilpay\plans\.audit-evidence\' + $f
  if (-not (Test-Path $p)) { continue }
  $raw = Get-Content $p -Raw
  $start = $raw.IndexOf('[')
  if ($start -lt 0) { Write-Host "$f -> no JSON array start"; continue }
  # try to find matching end of array (last ]) by brackets
  $end = $raw.LastIndexOf(']')
  if ($end -lt $start) { Write-Host "$f -> no JSON array end"; continue }
  $json = $raw.Substring($start, $end - $start + 1)
  try {
    $arr = $json | ConvertFrom-Json
    $errs = 0
    $filesWith = 0
    $rules = @{}
    foreach ($entry in $arr) {
      $errs += [int]$entry.errorCount
      if ($entry.errorCount -gt 0) { $filesWith++ }
      foreach ($m in $entry.messages) {
        $r = $m.ruleId
        if ([string]::IsNullOrEmpty($r)) { $r = '(parse-error)' }
        if ($m.severity -eq 2) {
          if ($rules.ContainsKey($r)) { $rules[$r] = $rules[$r] + 1 } else { $rules[$r] = 1 }
        }
      }
    }
    Write-Host ("{0} -> errors={1}, filesWithErrors={2}, totalEntries={3}" -f $f, $errs, $filesWith, $arr.Count)
    $top = $rules.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 8
    foreach ($t in $top) { Write-Host ("    {0} = {1}" -f $t.Key, $t.Value) }
  } catch {
    Write-Host "$f -> parse failed: $($_.Exception.Message)"
  }
}
