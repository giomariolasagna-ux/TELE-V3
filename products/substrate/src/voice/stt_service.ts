/**
 * Speech-to-Text Service using Whisper.cpp
 * Wraps local whisper-cli.exe for offline transcription
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface TranscriptionResult {
    text: string;
    language?: string;
    duration?: number;
    error?: string;
}

export class STTService {
    private whisperPath: string;
    private modelPath: string;

    constructor() {
        // Paths relative to substrate root
        const substrateRoot = path.resolve(__dirname, '..', '..');
        this.whisperPath = path.join(substrateRoot, 'bin', 'whisper', 'Release', 'whisper-cli.exe');
        this.modelPath = path.join(substrateRoot, 'bin', 'whisper', 'ggml-base.bin');

        // Validate paths
        if (!fs.existsSync(this.whisperPath)) {
            console.error(`[STT] Whisper CLI not found at: ${this.whisperPath}`);
        }
        if (!fs.existsSync(this.modelPath)) {
            console.error(`[STT] Whisper model not found at: ${this.modelPath}`);
        }
    }

    /**
     * Transcribe an audio file to text
     * @param audioPath Path to WAV file (16kHz, mono recommended)
     * @param language Optional language code (e.g., 'it', 'en')
     */
    async transcribe(audioPath: string, language: string = 'auto'): Promise<TranscriptionResult> {
        return new Promise((resolve) => {
            if (!fs.existsSync(audioPath)) {
                resolve({ text: '', error: `Audio file not found: ${audioPath}` });
                return;
            }

            const args = [
                '-m', this.modelPath,
                '-f', audioPath,
                '-l', language,
                '--no-timestamps',
                '-nt',  // No timestamps in output
                '-p', '1',  // Single thread for consistency
            ];

            console.log(`[STT] Transcribing: ${audioPath}`);
            const startTime = Date.now();

            const whisper = spawn(this.whisperPath, args);

            let stdout = '';
            let stderr = '';

            whisper.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            whisper.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            whisper.on('close', (code) => {
                const duration = (Date.now() - startTime) / 1000;
                console.log(`[STT] Completed in ${duration.toFixed(2)}s with code ${code}`);

                if (code !== 0) {
                    resolve({ text: '', error: stderr || 'Transcription failed', duration });
                    return;
                }

                // Parse output - whisper-cli outputs text directly
                const text = stdout.trim();
                resolve({ text, duration });
            });

            whisper.on('error', (err) => {
                resolve({ text: '', error: err.message });
            });
        });
    }

    /**
     * Check if the STT service is properly configured
     */
    isReady(): boolean {
        return fs.existsSync(this.whisperPath) && fs.existsSync(this.modelPath);
    }
}
