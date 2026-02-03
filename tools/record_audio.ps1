
param(
    [string]$File = "$env:USERPROFILE\.tele\voice\input\capture.wav",
    [int]$Seconds = 5
)

$code = @"
[DllImport("winmm.dll", EntryPoint = "mciSendStringA", CharSet = CharSet.Ansi)]
public static extern int mciSendString(string lpszCommand, StringBuilder lpszReturnString, int cchReturn, IntPtr hwndCallback);
"@

$winmm = Add-Type -MemberDefinition $code -Name "Winmm" -Namespace Win32 -PassThru

Write-Host "Recording for $Seconds seconds..."
$winmm::mciSendString("open new type waveaudio alias myrec", $null, 0, 0)
$winmm::mciSendString("record myrec", $null, 0, 0)
Start-Sleep -Seconds $Seconds
$winmm::mciSendString("save myrec $File", $null, 0, 0)
$winmm::mciSendString("close myrec", $null, 0, 0)
Write-Host "Saved to $File"
