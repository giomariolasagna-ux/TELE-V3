
import { spawn } from 'child_process';

// MVP: Windows SAPI via PowerShell
// Low latency, local, no dependencies.
export class TTSProvider {

    async speak(text: string) {
        // Sanitize
        const safeText = text.replace(/"/g, "'");
        // Fire and forget spawn to not block
        const psCommand = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("${safeText}")`;

        spawn('powershell', ['-Command', psCommand], {
            stdio: 'ignore', // Don't care about output
            detached: true   // Don't wait
        });
    }
}
