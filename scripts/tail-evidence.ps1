param([string] $File, [int] $Tail = 80)
$p = 'd:\Veilpay\plans\.audit-evidence\' + $File
Get-Content $p -Tail $Tail
