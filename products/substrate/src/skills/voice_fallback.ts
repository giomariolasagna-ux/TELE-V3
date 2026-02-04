/**
 * Voice Fallback Handler - STT/TTS error recovery dialog
 * Part of God Mode System - Challenge 5
 * 
 * Features:
 * - Voice-guided error recovery
 * - Retry with clarification
 * - Abort with explanation
 * - User confirmation dialogs
 */

import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export interface FallbackContext {
    originalCommand: string;
    error: Error | string;
    skillId?: string;
    actionName?: string;
    retryCount: number;
    startTime: number;
}

export interface FallbackOption {
    id: string;
    label: string;
    voicePrompt: string;
    action: () => Promise<FallbackResult>;
}

export type FallbackResult =
    | { type: 'retry'; newCommand?: string }
    | { type: 'abort'; reason: string }
    | { type: 'skip' }
    | { type: 'alternative'; skillId: string; actionName: string; params: any }
    | { type: 'human_takeover' };

export interface TTSProvider {
    speak(text: string): Promise<void>;
    isSpeaking(): boolean;
    stop(): void;
}

export interface STTProvider {
    listen(options?: { timeout?: number }): Promise<string>;
    isListening(): boolean;
    stop(): void;
}

// =============================================================================
// Default Providers (Console-based for testing)
// =============================================================================

class ConsoleTTSProvider implements TTSProvider {
    private speaking = false;

    async speak(text: string): Promise<void> {
        this.speaking = true;
        console.log(`[TTS] 🔊 ${text}`);
        // Simulate speech duration
        await new Promise(r => setTimeout(r, text.length * 50));
        this.speaking = false;
    }

    isSpeaking(): boolean { return this.speaking; }
    stop(): void { this.speaking = false; }
}

class ConsoleSTTProvider implements STTProvider {
    private listening = false;

    async listen(options?: { timeout?: number }): Promise<string> {
        this.listening = true;
        console.log('[STT] 🎤 Listening...');

        // In real implementation, this would use whisper.cpp or similar
        // For now, return a simulated response after timeout
        await new Promise(r => setTimeout(r, options?.timeout || 3000));

        this.listening = false;
        return 'retry'; // Default simulated response
    }

    isListening(): boolean { return this.listening; }
    stop(): void { this.listening = false; }
}

// =============================================================================
// Voice Fallback Handler
// =============================================================================

export class VoiceFallbackHandler extends EventEmitter {
    private tts: TTSProvider;
    private stt: STTProvider;
    private maxRetries: number;
    private enabled: boolean = true;

    constructor(
        tts?: TTSProvider,
        stt?: STTProvider,
        maxRetries = 3
    ) {
        super();
        this.tts = tts || new ConsoleTTSProvider();
        this.stt = stt || new ConsoleSTTProvider();
        this.maxRetries = maxRetries;
    }

    // -------------------------------------------------------------------------
    // Main Error Handling Flow
    // -------------------------------------------------------------------------

    async handleError(context: FallbackContext): Promise<FallbackResult> {
        if (!this.enabled) {
            return { type: 'abort', reason: 'Fallback handler disabled' };
        }

        const errorMessage = typeof context.error === 'string'
            ? context.error
            : context.error.message;

        this.emit('fallback_start', context);

        // Announce the error
        await this.tts.speak(
            `I encountered an error: ${this.simplifyError(errorMessage)}. ` +
            `Would you like me to retry, skip this step, or stop?`
        );

        // Listen for user response
        const response = await this.stt.listen({ timeout: 10000 });
        const action = this.parseResponse(response);

        this.emit('fallback_response', { context, response, action });

        switch (action) {
            case 'retry':
                if (context.retryCount >= this.maxRetries) {
                    await this.tts.speak(`I've already tried ${this.maxRetries} times. Would you like to provide a different command?`);
                    const newCommand = await this.stt.listen({ timeout: 15000 });
                    if (newCommand && newCommand !== 'stop' && newCommand !== 'cancel') {
                        return { type: 'retry', newCommand };
                    }
                    return { type: 'abort', reason: 'Max retries exceeded' };
                }
                await this.tts.speak('Retrying now...');
                return { type: 'retry' };

            case 'skip':
                await this.tts.speak('Skipping this step and continuing...');
                return { type: 'skip' };

            case 'stop':
            case 'cancel':
            case 'abort':
                await this.tts.speak('Stopping the current operation.');
                return { type: 'abort', reason: 'User requested abort' };

            case 'human':
                await this.tts.speak('Handing control over to you.');
                return { type: 'human_takeover' };

            default:
                // Treat unknown response as potential new command
                if (response.length > 3) {
                    await this.tts.speak('I\'ll try that instead.');
                    return { type: 'retry', newCommand: response };
                }
                return { type: 'retry' };
        }
    }

    // -------------------------------------------------------------------------
    // Confirmation Dialogs
    // -------------------------------------------------------------------------

    async confirmAction(
        description: string,
        isDangerous = false
    ): Promise<boolean> {
        const prompt = isDangerous
            ? `Warning: ${description}. This action may have significant effects. Are you sure you want to proceed?`
            : `${description}. Should I continue?`;

        await this.tts.speak(prompt);
        const response = await this.stt.listen({ timeout: 10000 });

        return this.isAffirmative(response);
    }

    async askForClarification(question: string): Promise<string> {
        await this.tts.speak(question);
        return await this.stt.listen({ timeout: 15000 });
    }

    async presentOptions(
        prompt: string,
        options: FallbackOption[]
    ): Promise<FallbackOption | null> {
        // Build voice prompt
        let fullPrompt = prompt + ' Your options are: ';
        options.forEach((opt, i) => {
            fullPrompt += `${i + 1}, ${opt.label}. `;
        });
        fullPrompt += 'What would you like to do?';

        await this.tts.speak(fullPrompt);
        const response = await this.stt.listen({ timeout: 15000 });

        // Match response to option
        const lowerResponse = response.toLowerCase();

        // Try number matching
        const numMatch = lowerResponse.match(/\d+/);
        if (numMatch) {
            const idx = parseInt(numMatch[0]) - 1;
            if (idx >= 0 && idx < options.length) {
                return options[idx];
            }
        }

        // Try label matching
        for (const option of options) {
            if (lowerResponse.includes(option.label.toLowerCase()) ||
                lowerResponse.includes(option.id.toLowerCase())) {
                return option;
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Notifications
    // -------------------------------------------------------------------------

    async announce(message: string): Promise<void> {
        await this.tts.speak(message);
    }

    async announceSuccess(action: string): Promise<void> {
        await this.tts.speak(`${action} completed successfully.`);
    }

    async announceProgress(action: string, progress: number): Promise<void> {
        if (progress === 100) {
            await this.tts.speak(`${action} is complete.`);
        } else if (progress === 0) {
            await this.tts.speak(`Starting ${action}...`);
        } else if (progress % 25 === 0) {
            await this.tts.speak(`${action} is ${progress}% complete.`);
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private simplifyError(error: string): string {
        // Convert technical errors to user-friendly messages
        const patterns: [RegExp, string][] = [
            [/ENOENT.*no such file/i, 'the file was not found'],
            [/EACCES|permission denied/i, 'I don\'t have permission to do that'],
            [/timeout|timed out/i, 'it took too long'],
            [/ECONNREFUSED/i, 'the connection was refused'],
            [/not found|undefined/i, 'something was not found'],
            [/invalid/i, 'the input was invalid'],
        ];

        for (const [pattern, replacement] of patterns) {
            if (pattern.test(error)) {
                return replacement;
            }
        }

        // Truncate long errors
        return error.length > 100 ? error.substring(0, 100) + '...' : error;
    }

    private parseResponse(response: string): string {
        const lower = response.toLowerCase().trim();

        if (/^(yes|yeah|yep|sure|ok|okay|retry|again|try again)/i.test(lower)) {
            return 'retry';
        }
        if (/^(skip|next|move on|continue)/i.test(lower)) {
            return 'skip';
        }
        if (/^(stop|cancel|abort|quit|no|nope|nevermind)/i.test(lower)) {
            return 'stop';
        }
        if (/^(help|human|manual|take over)/i.test(lower)) {
            return 'human';
        }

        return lower;
    }

    private isAffirmative(response: string): boolean {
        return /^(yes|yeah|yep|sure|ok|okay|absolutely|definitely|go|proceed)/i.test(
            response.toLowerCase().trim()
        );
    }

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setTTS(provider: TTSProvider): void {
        this.tts = provider;
    }

    setSTT(provider: STTProvider): void {
        this.stt = provider;
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const globalFallbackHandler = new VoiceFallbackHandler();
