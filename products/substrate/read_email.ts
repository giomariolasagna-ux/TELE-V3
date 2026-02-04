// Read last email from Gmail
import { google } from 'googleapis';
import * as fs from 'fs';

const TOKEN_PATH = './.tele/google_credentials.json';
const CREDENTIALS_PATH = './.tele/google_client_secret.json';

async function readLastEmail() {
    // Load credentials
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const { web, installed } = JSON.parse(content);
    const credentials = web || installed;

    const oauth2Client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        'http://localhost:3333/oauth2callback'
    );

    // Load saved tokens
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get latest message
    console.log('Fetching your latest email...\n');

    const { data } = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 1,
        labelIds: ['INBOX']
    });

    if (!data.messages || data.messages.length === 0) {
        console.log('No emails found.');
        return;
    }

    // Get full message
    const msg = await gmail.users.messages.get({
        userId: 'me',
        id: data.messages[0].id!,
        format: 'full'
    });

    const headers = msg.data.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || 'unknown';
    const date = headers.find(h => h.name === 'Date')?.value || '';

    // Get body
    let body = '';
    if (msg.data.payload?.body?.data) {
        body = Buffer.from(msg.data.payload.body.data, 'base64').toString('utf-8');
    } else if (msg.data.payload?.parts) {
        const textPart = msg.data.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
    }

    console.log('===========================================');
    console.log('  📧 YOUR LATEST EMAIL');
    console.log('===========================================\n');
    console.log(`From: ${from}`);
    console.log(`Date: ${date}`);
    console.log(`Subject: ${subject}`);
    console.log('\n-------------------------------------------\n');
    console.log(body.substring(0, 1000) + (body.length > 1000 ? '...' : ''));
    console.log('\n===========================================');
}

readLastEmail().catch(console.error);
