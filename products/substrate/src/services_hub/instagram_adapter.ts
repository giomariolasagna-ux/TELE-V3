// Instagram Graph API Adapter - Phase 11
// OAuth2 authentication using Facebook Login for Business (Required for Graph API)

import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { globalEventBus, BusEventType } from '../event_bus';
import { ServiceAdapter } from './index';

// Token storage paths
const TOKEN_PATH = './.tele/instagram_credentials.json';
const CREDENTIALS_PATH = './.tele/instagram_client_secret.json';

// Facebook Graph API endpoints (Used for Instagram Graph API)
const FACEBOOK_API_VERSION = 'v19.0';
const AUTH_URL = `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`;
const TOKEN_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token`;
const GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;

// OAuth scopes
// pages_show_list: needed to find the page linked to Instagram
// instagram_basic: needed for basic profile info
// business_management: often required for business login
const SCOPES = [
    'pages_show_list',
    'instagram_basic',
    'business_management'
];

export class InstagramAdapter implements ServiceAdapter {
    id = 'instagram';
    name = 'Instagram (Business)';
    type: 'instagram' = 'instagram';
    status: ServiceAdapter['status'] = 'disconnected';
    authRequired = true;
    authType: 'oauth' = 'oauth';

    private credentials: { client_id: string; client_secret: string; redirect_uri: string } | null = null;
    private accessToken: string | null = null;
    private userId: string | null = null; // Facebook User ID
    private instagramBusinessId: string | null = null; // Instagram Business Account ID

    constructor() {
        this.loadCredentials();
    }

    private loadCredentials() {
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
                this.credentials = JSON.parse(content);

                // Try to load saved tokens
                if (fs.existsSync(TOKEN_PATH)) {
                    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
                    this.accessToken = tokens.access_token;
                    this.userId = tokens.user_id;
                    this.instagramBusinessId = tokens.instagram_business_id;

                    if (this.accessToken && this.instagramBusinessId) {
                        this.status = 'connected';
                        console.log(`[Instagram] Loaded saved credentials (IG ID: ${this.instagramBusinessId})`);
                    }
                }
            }
        } catch (error) {
            console.error('[Instagram] Error loading credentials:', error);
        }
    }

    async connect(): Promise<void> {
        if (!this.credentials) {
            // ... (keep existing instructions but possibly update URL)
            console.log('\n===========================================');
            console.log('  INSTAGRAM OAUTH - SETUP REQUIRED');
            console.log('===========================================\n');
            console.log('NOTE: Since you are using a Business/Creator account, we use Facebook Login.');
            console.log('1. Go to https://developers.facebook.com/apps');
            console.log('2. Select your app');
            console.log('3. Ensure "Facebook Login for Business" product is added (or just standard Facebook Login)');
            console.log('4. Add "Website" platform is configured with http://localhost:3334/');
            console.log('5. Ensure "Valid OAuth Redirect URIs" includes http://localhost:3334/oauth2callback');
            throw new Error('Instagram credentials not configured');
        }

        // Check if already authenticated
        if (this.status === 'connected' && this.accessToken && this.instagramBusinessId) {
            console.log('[Instagram] Already connected');
            return;
        }

        // Generate auth URL
        const authUrl = `${AUTH_URL}?client_id=${this.credentials.client_id}&redirect_uri=${encodeURIComponent(this.credentials.redirect_uri)}&scope=${SCOPES.join(',')}&response_type=code`;

        console.log('\n===========================================');
        console.log('  INSTAGRAM OAUTH (via FACEBOOK)');
        console.log('===========================================\n');
        console.log('Opening browser for authentication...');
        console.log('Please log in with the FACEBOOK account that manages your Instagram Page.\n');
        console.log(authUrl);
        console.log('\n');

        // Open browser
        const open = (await import('open')).default;
        await open(authUrl);

        // Start local server to receive callback
        const code = await this.waitForAuthCode();

        // Exchange code for tokens
        await this.exchangeCodeForToken(code);

        // Find Instagram Business Account ID
        await this.resolveInstagramBusinessId();

        this.status = 'connected';
        console.log('\n✅ Instagram authentication successful!');
        console.log(`Linked to Instagram Business ID: ${this.instagramBusinessId}`);
        console.log('Credentials saved for future use.\n');

        globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
            description: 'Instagram Business connected successfully!'
        });
    }

    private waitForAuthCode(): Promise<string> {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                try {
                    const queryObject = url.parse(req.url!, true).query;
                    const code = queryObject.code as string;
                    const error = queryObject.error_message || queryObject.error_description;

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                            <body style="font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(135deg, #1877F2, #ffffff); color: #333;">
                                <h1>✅ Facebook Login Successful!</h1>
                                <p>We are now connecting your Instagram account...</p>
                                <script>setTimeout(() => window.close(), 2000);</script>
                            </body>
                            </html>
                        `);
                        server.close();
                        resolve(code);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<h1>Authentication Failed</h1><p>${error || 'Unknown error'}</p>`);
                        server.close();
                        reject(new Error(error ? String(error) : 'No authorization code received'));
                    }
                } catch (e) {
                    reject(e);
                }
            });

            server.listen(3334, () => {
                console.log('[Instagram] Waiting for OAuth callback on http://localhost:3334...');
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                server.close();
                reject(new Error('OAuth timeout'));
            }, 5 * 60 * 1000);
        });
    }

    private async exchangeCodeForToken(code: string): Promise<void> {
        if (!this.credentials) {
            throw new Error('Credentials not loaded');
        }

        const url = `${TOKEN_URL}?client_id=${this.credentials.client_id}&redirect_uri=${encodeURIComponent(this.credentials.redirect_uri)}&client_secret=${this.credentials.client_secret}&code=${code}`;

        const response = await fetch(url);
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token exchange failed: ${error}`);
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        // Facebook Graph API sometimes returns user id in token response, sometimes not.
        // We'll verify token to get user ID if needed, but usually access_token is enough for next steps.
    }

    private async resolveInstagramBusinessId(): Promise<void> {
        if (!this.accessToken) return;

        console.log('[Instagram] Looking for linked Instagram Business Account...');

        // fetch pages and their connected instagram accounts
        const response = await fetch(
            `${GRAPH_URL}/me/accounts?fields=name,instagram_business_account&access_token=${this.accessToken}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch Facebook Pages');
        }

        const data = await response.json();
        const pages = data.data || [];

        // Find first page with an instagram_business_account
        const connectedPage = pages.find((p: any) => p.instagram_business_account);

        if (!connectedPage) {
            throw new Error(
                'No Instagram Business Account found linked to your Facebook Pages. ' +
                'Please make sure your Instagram account is switched to Business/Creator and linked to a Facebook Page.'
            );
        }

        this.instagramBusinessId = connectedPage.instagram_business_account.id;
        this.userId = connectedPage.id; // Using Page ID as context might be useful, but let's persist IG ID.

        // Save tokens
        fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
        fs.writeFileSync(TOKEN_PATH, JSON.stringify({
            access_token: this.accessToken,
            user_id: this.userId, // This might be Page ID or User ID, doesn't matter much as long as we have IG ID
            instagram_business_id: this.instagramBusinessId
        }, null, 2));
    }

    async disconnect(): Promise<void> {
        this.accessToken = null;
        this.userId = null;
        this.instagramBusinessId = null;
        this.status = 'disconnected';
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }
    }

    async getUserProfile(): Promise<{ id: string; username: string; name?: string } | null> {
        if (!this.accessToken || !this.instagramBusinessId || this.status !== 'connected') {
            return null;
        }

        const response = await fetch(
            `${GRAPH_URL}/${this.instagramBusinessId}?fields=id,username,name,profile_picture_url&access_token=${this.accessToken}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch user profile');
        }

        return await response.json();
    }

    async getRecentMedia(limit = 10): Promise<any[]> {
        if (!this.accessToken || !this.instagramBusinessId || this.status !== 'connected') {
            return [];
        }

        const response = await fetch(
            `${GRAPH_URL}/${this.instagramBusinessId}/media?fields=id,caption,media_type,media_url,timestamp,permalink&limit=${limit}&access_token=${this.accessToken}`
        );

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.data || [];
    }

    getStatus(): string {
        return this.status;
    }

    isConnected(): boolean {
        return this.status === 'connected' && !!this.accessToken && !!this.instagramBusinessId;
    }
}

// Export singleton
export const instagramAdapter = new InstagramAdapter();
