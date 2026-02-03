import * as getStdin from 'readline';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';

export interface STTResult {
    text: string;
    isFinal: boolean;
}

export class STTProvider extends EventEmitter {
    private isSimulation: boolean = true;
    private inputDir: string;
    private currentProcess: cp.ChildProcess | null = null;
    private watcher: any = null;

    constructor() {
        super();
        // default true if explicitly "1" or missing. If "0", real.
        // Wait, current logic: "process.env.TEXT_SIMULATION === '1' || true" -> Always true!
        // Fixed logic:
        this.isSimulation = process.env.TEXT_SIMULATION === '1';

        this.inputDir = path.join(os.homedir(), '.tele', 'voice', 'input');
        if (!this.isSimulation) {
            fs.mkdirSync(this.inputDir, { recursive: true });
        }
    }

    start() {
        if (this.isSimulation) {
            console.log("[STT] Starting Text Simulation (Stdin)...");
            this.startTextSimulation();
        } else {
            console.log(`[STT] Starting Whisper.cpp Watcher in ${this.inputDir}...`);
            this.startFileWatcher();
        }
    }

    stop() {
        if (this.currentProcess) {
            console.log("[STT] STOP signal received. Killing process...");
            this.currentProcess.kill();
            this.currentProcess = null;
        }
    }

    private startTextSimulation() {
        const rl = getStdin.createInterface({
            input: process.stdin,
            output: process.stderr
        });

        rl.on('line', (line) => {
            if (!line.trim()) return;
            // Support simulated cancellation if user types "STOP" (handled by runner logic normally, but here we just pass intent)
            this.emit('transcript', {
                text: line.trim(),
                isFinal: true
            });
        });
    }

    private startFileWatcher() {
        console.log(`[STT] Watching ${this.inputDir} (Fast Mode)`);

        let processed = new Set<string>();

        // Debounced Watcher or Polling?
        // fs.watch sends 'rename' for file creation.
        // But file might still be writing?
        // Safe approach: Fast Poll (200ms) + Check File Lock (open readable).
        // On Windows, if capturing script is writing, it might be locked.

        setInterval(async () => {
            if (this.currentProcess) return;

            try {
                const files = fs.readdirSync(this.inputDir)
                    .filter(f => f.endsWith('.wav') && !processed.has(f))
                    .sort(); // Oldest first?

                if (files.length > 0) {
                    const file = files[0];
                    const fullPath = path.join(this.inputDir, file);

                    // Check if ready (size > 0)
                    const stats = fs.statSync(fullPath);
                    if (stats.size === 0) return;

                    // Determine timestamp from filename voice_<ts>.wav
                    // Format: voice_1700000000000.wav
                    let recordEndTs = Date.now();
                    const match = file.match(/voice_(\d+)\.wav/);
                    if (match) {
                        recordEndTs = parseInt(match[1]);
                    }

                    // Process
                    processed.add(file);
                    console.log(`[STT] Processing: ${file} (Lag: ${Date.now() - recordEndTs}ms)`);

                    await this.transcribeFile(fullPath, recordEndTs);

                    // Cleanup
                    try {
                        if (process.env.KEEP_VOICE_TEMP !== '1') fs.unlinkSync(fullPath);
                    } catch (e) { }
                    processed.delete(file);
                }
            } catch (e) {
                // ignore access errors
            }
        }, 200);
    }

    private async transcribeFile(filePath: string, recordEndTs: number) {
        const bin = process.env.WHISPER_CPP_BIN;
        const model = process.env.WHISPER_CPP_MODEL;

        if (!bin || !model) {
            console.error("[STT] Missing WHISPER_CPP_BIN or WHISPER_CPP_MODEL env vars.");
            return;
        }

        return new Promise<void>((resolve) => {
            const args = [
                '-m', model,
                '-f', filePath,
                '--no-timestamps' // output plain text to stdout
            ];

            // Add user args
            if (process.env.WHISPER_CPP_ARGS) {
                args.push(...process.env.WHISPER_CPP_ARGS.split(' '));
            }

            console.log(`[STT] Spawning: ${bin} ${args.join(' ')}`);
            this.currentProcess = cp.spawn(bin, args);

            let stdout = '';
            let stderr = '';

            this.currentProcess.stdout?.on('data', (d) => stdout += d.toString());
            this.currentProcess.stderr?.on('data', (d) => stderr += d.toString());

            this.currentProcess.on('close', (code) => {
                this.currentProcess = null;
                if (code === 0 || code === null) { // code null if killed?
                    // Whisper.cpp output might be in stdout or a file.
                    // Default behavior of main is stdout with timestamps unless disabled.
                    // If -otxt is used, it writes to file.
                    // Let's rely on stdout if possible. 
                    // Assuming stdout contains the text.
                    // Actually, main often prints info to stderr and text to stdout.

                    const text = stdout.trim();
                    const now = Date.now();
                    const latency = now - recordEndTs;

                    console.log(`[STT] Transcription: "${text}" (STT Latency: ${latency}ms)`);

                    if (text) {
                        this.emit('transcript', {
                            text: text,
                            isFinal: true,
                            latencyMs: latency
                        });
                    }
                } else {
                    console.error(`[STT] Whisper failed with code ${code}. Stderr: ${stderr}`);
                }
                resolve();
            });

            this.currentProcess.on('error', (err) => {
                console.error("[STT] Process Error:", err);
                this.currentProcess = null;
                resolve();
            });
        });
    }
}
