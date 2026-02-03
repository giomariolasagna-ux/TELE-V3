
import { TTSProvider } from './tts';
import { STTProvider } from './stt';
import { VoicePacket, IntentEventObject, InterruptEvent } from '../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';

const tts = new TTSProvider();
const stt = new STTProvider();

// Helper to emit JSON packet to STDOUT (IPC)
function emitPacket(packet: VoicePacket) {
    console.log(JSON.stringify(packet));
}

// STT Logic
stt.on('transcript', (data: { text: string, isFinal: boolean, latencyMs?: number }) => {
    const raw = data.text.trim();
    const lower = raw.toLowerCase();
    const meta = { latencyMs: data.latencyMs };

    // 1. Check for HARD INTERRUPTS
    if (lower === 'stop' || lower === 'halt' || lower === 'abort') {
        emitPacket({
            type: 'INTERRUPT',
            payload: {
                id: uuidv4(),
                type: 'STOP',
                timestamp: new Date().toISOString(),
                metadata: meta
            }
        });
        tts.speak('Stopping.');
        return;
    }

    if (lower === 'pause') {
        emitPacket({
            type: 'INTERRUPT',
            payload: {
                id: uuidv4(),
                type: 'PAUSE',
                timestamp: new Date().toISOString(),
                metadata: meta
            }
        });
        tts.speak('Paused.');
        return;
    }

    if (lower === 'continue' || lower === 'resume') {
        emitPacket({
            type: 'INTERRUPT',
            payload: {
                id: uuidv4(),
                type: 'CONTINUE',
                timestamp: new Date().toISOString(),
                metadata: meta
            }
        });
        tts.speak('Resuming.');
        return;
    }

    // 2. Otherwise treat as Intent
    emitPacket({
        type: 'INTENT',
        payload: {
            id: uuidv4(),
            sourceChannel: 'voice-local',
            sourceUserId: 'user',
            timestamp: new Date().toISOString(),
            rawContent: raw,
            metadata: meta
        }
    });
});

// Start
console.error(`[VoiceService] Starting. Type 'stop', 'scan temp', 'cleanup' to interact.`);
stt.start();
tts.speak("Voice System Ready.");

// IPC Control (For Real Mode to receive STOP from Runner)
if (process.env.TEXT_SIMULATION !== '1') {
    const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stderr,
        terminal: false
    });

    rl.on('line', (line: string) => {
        const cmd = line.trim().toLowerCase();
        if (cmd === 'stop') {
            console.error("[VoiceService] Received IPC STOP. Aborting STT...");
            stt.stop();
        }
    });
}
