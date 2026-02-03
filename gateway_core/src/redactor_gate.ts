
export class RedactorGate {
    static redact(text: string): string {
        let safe = text;
        // Basic Env Redaction if they leak
        if (process.env.TELE_TELEGRAM_BOT_TOKEN && safe.includes(process.env.TELE_TELEGRAM_BOT_TOKEN)) {
            safe = safe.split(process.env.TELE_TELEGRAM_BOT_TOKEN).join('[REDACTED_TOKEN]');
        }
        // Custom patterns
        safe = safe.replace(/sk-[a-zA-Z0-9\-_]{20,}/g, '[REDACTED_API_KEY]');
        safe = safe.replace(/Bearer [a-zA-Z0-9\-_]{20,}/gi, 'Bearer [REDACTED_TOKEN]');
        safe = safe.replace(/api_key=[a-zA-Z0-9\-_]{20,}/gi, 'api_key=[REDACTED_KEY]');
        // IP Address (local is fine, public maybe) - skipped for now as not requested
        return safe;
    }
}
