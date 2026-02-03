
param(
    [string]$File = "$env:USERPROFILE\.tele\voice\input\capture.wav"
)

# MCI P/Invoke
$code = @"
[DllImport("winmm.dll", EntryPoint = "mciSendStringA", CharSet = CharSet.Ansi)]
public static extern int mciSendString(string lpszCommand, StringBuilder lpszReturnString, int cchReturn, IntPtr hwndCallback);
"@

$winmm = Add-Type -MemberDefinition $code -Name "Winmm" -Namespace Win32 -PassThru

# Unique alias to avoid conflicts
$alias = "rec_" + (Get-Random)

# Cleanup existing
if (Test-Path $File) { Remove-Item $File }

# Start Recording
$winmm::mciSendString("open new type waveaudio alias $alias", $null, 0, 0)
$winmm::mciSendString("record $alias", $null, 0, 0)

Write-Host "RECORDING"

# Wait for Stop Signal (Stdin)
try {
    $null = [Console]::In.ReadLine() 
}
catch {
    # If pipe closes
}

# Stop and Save
$winmm::mciSendString("stop $alias", $null, 0, 0)
$winmm::mciSendString("save $alias `"$File`"", $null, 0, 0)
$winmm::mciSendString("close $alias", $null, 0, 0)

Write-Host "SAVED"
