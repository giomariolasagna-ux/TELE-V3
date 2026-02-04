// List your actual saved contacts to find the RIGHT Greta
import { Client, LocalAuth } from 'whatsapp-web.js';

async function listContacts() {
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
        console.log('[WhatsApp] Client is ready!\n');

        try {
            const contacts = await client.getContacts();

            // Filter to only SAVED contacts (isMyContact = true)
            const savedContacts = contacts.filter((c: any) =>
                c.isMyContact && (c.name || c.pushname)
            );

            console.log('=== YOUR SAVED CONTACTS ===\n');

            // Find all contacts with "greta" in the name
            const gretas = savedContacts.filter((c: any) =>
            (c.name?.toLowerCase().includes('greta') ||
                c.pushname?.toLowerCase().includes('greta'))
            );

            if (gretas.length > 0) {
                console.log('Contacts named "Greta":\n');
                gretas.forEach((c: any, i: number) => {
                    console.log(`  ${i + 1}. ${c.name || c.pushname}`);
                    console.log(`     Phone: ${c.number}`);
                    console.log(`     ID: ${c.id._serialized}\n`);
                });
            } else {
                console.log('No saved contact named "Greta" found.\n');
                console.log('Here are all your saved contacts:\n');
                savedContacts.forEach((c: any) => {
                    console.log(`  - ${c.name || c.pushname} (${c.number || 'no number'})`);
                });
            }

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

listContacts().catch(console.error);
