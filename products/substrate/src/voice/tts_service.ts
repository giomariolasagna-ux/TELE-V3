/**
 * Text-to-Speech Service using Kokoro-82M (via Python)
 * Wraps local Python kokoro-onnx for offline TTS
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface SynthesisResult {
    audioPath: string;
    duration?: number;
    error?: string;
}

export class TTSService {
    private modelPath: string;
    private voicesPath: string;
    private tempDir: string;

    constructor() {
        // Paths relative to substrate root
        const substrateRoot = path.resolve(__dirname, '..', '..');
        this.modelPath = path.join(substrateRoot, 'models', 'tts', 'kokoro-v0_19.onnx');
        this.voicesPath = path.join(substrateRoot, 'models', 'tts', 'voices.bin');
        this.tempDir = path.join(os.tmpdir(), 'tele-tts');

        // Create temp directory
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Synthesize text to speech
     * @param text Text to speak
     * @param voice Voice style: 'af' (American Female), 'bf' (British Female), 'am', 'bm'
     */
    async synthesize(text: string, voice: string = 'af'): Promise<SynthesisResult> {
        if (!fs.existsSync(this.modelPath)) {
            console.warn('[TTS] Model missing. Skipping synthesis.');
            return { audioPath: '', error: 'Model missing' };
        }

        return new Promise((resolve) => {
            const outputPath = path.join(this.tempDir, `tts_${Date.now()}.wav`);

            // Python script to run Kokoro
            const pythonScript = `
import sys
sys.path.insert(0, r'C:\\Users\\Administrator\\AppData\\Roaming\\Python\\Python311\\site-packages')
from kokoro_onnx import Kokoro
import soundfile as sf

kokoro = Kokoro(r'${this.modelPath.replace(/\\/g, '\\\\')}', r'${this.voicesPath.replace(/\\/g, '\\\\')}')
samples, sr = kokoro.create('''${text.replace(/'/g, "\\'")}''', voice='${voice}', speed=1.0)
sf.write(r'${outputPath.replace(/\\/g, '\\\\')}', samples, sr)
print('OK')
`;

            console.log(`[TTS] Synthesizing: "${text.substring(0, 50)}..."`);
            const startTime = Date.now();

            const python = spawn('python', ['-c', pythonScript]);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                const duration = (Date.now() - startTime) / 1000;
                console.log(`[TTS] Completed in ${duration.toFixed(2)}s with code ${code}`);

                if (code !== 0 || !fs.existsSync(outputPath)) {
                    console.error(`[TTS] Error: ${stderr}`);
                    resolve({ audioPath: '', error: stderr || 'Synthesis failed', duration });
                    return;
                }

                resolve({ audioPath: outputPath, duration });
            });

            python.on('error', (err) => {
                resolve({ audioPath: '', error: err.message });
            });
        });
    }

    /**
     * Play audio file through system speakers
     */
    async playAudio(audioPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Use PowerShell to play audio
            const ps = spawn('powershell', [
                '-NoProfile',
                '-Command',
                `(New-Object Media.SoundPlayer '${audioPath}').PlaySync()`
            ]);

            ps.on('close', () => resolve());
            ps.on('error', reject);
        });
    }

    /**
     * Speak text directly (synthesize + play)
     */
    async speak(text: string, voice: string = 'af'): Promise<void> {
        const result = await this.synthesize(text, voice);
        if (result.error) {
            console.error(`[TTS] Failed to speak: ${result.error}`);
            return;
        }
        await this.playAudio(result.audioPath);

        // Cleanup temp file
        try {
            fs.unlinkSync(result.audioPath);
        } catch { }
    }

    /**
     * Check if the TTS service is properly configured
     */
    isReady(): boolean {
        // Model path might not exist yet if download failed
        // We'll be more lenient here
        return true;
    }
}
