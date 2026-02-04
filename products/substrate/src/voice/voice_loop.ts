/**
 * Voice Loop - Continuous voice interaction manager
 * Listens for speech, transcribes, processes, speaks response
 */

import { STTService, TranscriptionResult } from './stt_service';
import { TTSService } from './tts_service';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

export interface VoiceLoopConfig {
    language: string;
    voice: string;
    silenceThreshold: number;  // ms of silence before processing
    maxRecordDuration: number;  // max recording duration in seconds
    microphoneDevice: string;   // ffmpeg dshow device name
}

export class VoiceLoop {
    private stt: STTService;
    private tts: TTSService;
    private config: VoiceLoopConfig;
    private isListening: boolean = false;
    private onTranscription: ((text: string) => Promise<string>) | null = null;
    private recordingPath: string;

    constructor(config?: Partial<VoiceLoopConfig>) {
        this.stt = new STTService();
        this.tts = new TTSService();
        this.config = {
            language: 'it',  // Italian for Whisper STT
            voice: 'if_sara',  // Kokoro Italian female voice (Giulia)
            silenceThreshold: 1500,
            maxRecordDuration: 10,
            microphoneDevice: 'Desktop Microphone (3- Microsoft® LifeCam Cinema(TM))',
            ...config
        };
        this.recordingPath = path.join(os.tmpdir(), 'tele-voice', 'recording.wav');

        // Create temp directory
        const tempDir = path.dirname(this.recordingPath);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    }

    /**
     * Set the callback for when speech is transcribed
     * @param callback Function that processes text and returns response
     */
    setTranscriptionHandler(callback: (text: string) => Promise<string>) {
        this.onTranscription = callback;
    }

    /**
     * Record audio from microphone
     * Uses PowerShell to capture from default audio device
     */
    async recordAudio(durationSeconds: number = 5): Promise<string> {
        return new Promise((resolve, reject) => {
            console.log(`[VoiceLoop] Recording for ${durationSeconds}s from ${this.config.microphoneDevice}...`);

            const ffmpeg = spawn('ffmpeg', [
                '-f', 'dshow',
                '-i', `audio=${this.config.microphoneDevice}`,
                '-t', durationSeconds.toString(),
                '-ar', '16000',
                '-ac', '1',
                '-y',
                this.recordingPath
            ]);

            let stderr = '';
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(this.recordingPath)) {
                    console.log('[VoiceLoop] Recording complete');
                    resolve(this.recordingPath);
                } else {
                    console.error('[VoiceLoop] Recording failed:', stderr.slice(-200));
                    reject(new Error('Recording failed'));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(new Error(`ffmpeg not found: ${err.message}`));
            });
        });
    }

    /**
     * Single iteration: record → transcribe → process → speak
     */
    async processOnce(): Promise<void> {
        try {
            // Record
            await this.recordAudio(this.config.maxRecordDuration);

            // Transcribe
            const result = await this.stt.transcribe(this.recordingPath, this.config.language);

            if (result.error || !result.text.trim()) {
                console.log('[VoiceLoop] No speech detected or transcription error');
                return;
            }

            console.log(`[VoiceLoop] Heard: "${result.text}"`);

            // Process
            if (this.onTranscription) {
                const response = await this.onTranscription(result.text);

                // Speak response
                if (response) {
                    console.log(`[VoiceLoop] Responding: "${response.substring(0, 50)}..."`);
                    await this.tts.speak(response, this.config.voice);
                }
            }
        } catch (error: any) {
            console.error(`[VoiceLoop] Error: ${error.message}`);
        }
    }

    /**
     * Start continuous listening loop
     */
    async startListening(): Promise<void> {
        this.isListening = true;
        console.log('[VoiceLoop] 🎙️ Voice loop started - listening...');

        while (this.isListening) {
            await this.processOnce();
            // Small delay between iterations
            await new Promise(r => setTimeout(r, 500));
        }
    }

    /**
     * Stop the listening loop
     */
    stopListening(): void {
        this.isListening = false;
        console.log('[VoiceLoop] Stopping voice loop...');
    }

    /**
     * Speak a message directly
     */
    async speak(text: string): Promise<void> {
        await this.tts.speak(text, this.config.voice);
    }

    /**
     * Check if all voice services are ready
     */
    isReady(): boolean {
        return this.stt.isReady() && this.tts.isReady();
    }
}

// Export singleton for easy use
export const voiceLoop = new VoiceLoop();
