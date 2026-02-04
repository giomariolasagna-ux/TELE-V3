// Google OAuth2 Adapter - Phase 11
// Authenticates with Google using OAuth2 flow

import { google } from 'googleapis';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { globalEventBus, BusEventType } from '../event_bus';
import { ServiceAdapter } from './index';

// Token storage path
const TOKEN_PATH = './.tele/google_credentials.json';
const CREDENTIALS_PATH = './.tele/google_client_secret.json';

// Scopes for Google APIs
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

export class GoogleOAuthAdapter implements ServiceAdapter {
    id = 'google';
    name = 'Google';
    type: 'google' = 'google';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = true;
    authType: 'oauth' = 'oauth';

    private oauth2Client: any = null;
    private credentials: any = null;

    constructor() {
        this.loadCredentials();
    }

    private loadCredentials() {
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
                const { web, installed } = JSON.parse(content);
                this.credentials = web || installed;

                this.oauth2Client = new google.auth.OAuth2(
                    this.credentials.client_id,
                    this.credentials.client_secret,
                    'http://localhost:3333/oauth2callback'
                );

                // Try to load saved tokens
                if (fs.existsSync(TOKEN_PATH)) {
                    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
                    this.oauth2Client.setCredentials(tokens);
                    this.status = 'connected';
                    console.log('[Google] Loaded saved credentials');
                }
            }
        } catch (error) {
            console.error('[Google] Error loading credentials:', error);
        }
    }

    async connect(): Promise<void> {
        if (!this.credentials) {
            console.log('\n===========================================');
            console.log('  GOOGLE OAUTH - SETUP REQUIRED');
            console.log('===========================================\n');
            console.log('1. Go to https://console.cloud.google.com/apis/credentials');
            console.log('2. Create OAuth 2.0 Client ID (Web application)');
            console.log('3. Add redirect URI: http://localhost:3333/oauth2callback');
            console.log('4. Download the JSON and save it to:');
            console.log(`   ${path.resolve(CREDENTIALS_PATH)}\n`);
            throw new Error('Google credentials not configured');
        }

        // Check if already authenticated
        if (this.status === 'connected' && this.oauth2Client.credentials?.access_token) {
            console.log('[Google] Already connected');
            return;
        }

        // Generate auth URL
        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });

        console.log('\n===========================================');
        console.log('  GOOGLE OAUTH - AUTHENTICATE');
        console.log('===========================================\n');
        console.log('Opening browser for authentication...');
        console.log('If browser does not open, visit:\n');
        console.log(authUrl);
        console.log('\n');

        // Open browser
        const open = (await import('open')).default;
        await open(authUrl);

        // Start local server to receive callback
        const code = await this.waitForAuthCode();

        // Exchange code for tokens
        const { tokens } = await this.oauth2Client.getToken(code);
        this.oauth2Client.setCredentials(tokens);

        // Save tokens
        fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

        this.status = 'connected';
        console.log('\n✅ Google authentication successful!');
        console.log('Credentials saved for future use.\n');

        globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
            description: 'Google OAuth connected successfully!'
        });
    }

    private waitForAuthCode(): Promise<string> {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                try {
                    const queryObject = url.parse(req.url!, true).query;
                    const code = queryObject.code as string;

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                            <body style="font-family: Arial; text-align: center; padding: 50px; background: #1a1a2e; color: #eee;">
                                <h1 style="color: #4ade80;">✅ Authentication Successful!</h1>
                                <p>You can close this window and return to TELE.</p>
                                <script>setTimeout(() => window.close(), 2000);</script>
                            </body>
                            </html>
                        `);
                        server.close();
                        resolve(code);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<h1>Error: No code received</h1>');
                        reject(new Error('No authorization code received'));
                    }
                } catch (e) {
                    reject(e);
                }
            });

            server.listen(3333, () => {
                console.log('[Google] Waiting for OAuth callback on http://localhost:3333...');
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                server.close();
                reject(new Error('OAuth timeout'));
            }, 5 * 60 * 1000);
        });
    }

    async disconnect(): Promise<void> {
        this.oauth2Client?.revokeCredentials();
        this.status = 'disconnected';
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }
    }

    getOAuth2Client() {
        return this.oauth2Client;
    }

    async getUserInfo(): Promise<{ email: string; name: string } | null> {
        if (!this.oauth2Client || this.status !== 'connected') {
            return null;
        }

        const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
        const { data } = await oauth2.userinfo.get();
        return { email: data.email!, name: data.name! };
    }

    async listGmailLabels(): Promise<string[]> {
        if (!this.oauth2Client || this.status !== 'connected') {
            return [];
        }

        const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
        const { data } = await gmail.users.labels.list({ userId: 'me' });
        return data.labels?.map(l => l.name!) || [];
    }

    async listCalendarEvents(maxResults = 10): Promise<any[]> {
        if (!this.oauth2Client || this.status !== 'connected') {
            return [];
        }

        const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
        const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            maxResults,
            singleEvents: true,
            orderBy: 'startTime'
        });
        return data.items || [];
    }
}

export const googleAdapter = new GoogleOAuthAdapter();
