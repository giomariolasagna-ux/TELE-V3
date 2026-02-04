// Send message to the correct Greta (393332005214)
import { Client, LocalAuth } from 'whatsapp-web.js';

const GRETA_ID = '393332005214@c.us';

async function sendToGreta() {
    console.log('Connecting to WhatsApp...');

    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './.tele/whatsapp_session'
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('ready', async () => {
        console.log('[WhatsApp] Client is ready!');

        try {
            const message = '👋 Ciao Greta! Questo messaggio è stato inviato da TELE Antigravity AI. 🚀';
            console.log(`Sending to ${GRETA_ID}...`);

            const sentMsg = await client.sendMessage(GRETA_ID, message);
            console.log('Message ID:', sentMsg.id._serialized);

            // Wait for delivery
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('✅ Message sent to Greta!');

            await client.destroy();
            process.exit(0);
        } catch (err) {
            console.error('Error:', err);
            await client.destroy();
            process.exit(1);
        }
    });

    client.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated');
    });

    await client.initialize();
}

sendToGreta().catch(console.error);
