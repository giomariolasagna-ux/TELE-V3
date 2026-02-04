// WhatsApp Web Connection Script
// Run this to connect your WhatsApp account

import { whatsappAdapter } from './src/services_hub/whatsapp_adapter';

async function main() {
    console.log('===========================================');
    console.log('   TELE Antigravity - WhatsApp Web Setup');
    console.log('===========================================\n');
    console.log('This will open a QR code in your terminal.');
    console.log('Scan it with your phone to link WhatsApp.\n');

    try {
        await whatsappAdapter.connect();
        console.log('\n[SUCCESS] WhatsApp Web is now connected!');
        console.log('You can now send and receive messages.\n');

        // Keep the process running
        process.stdin.resume();
    } catch (error) {
        console.error('\n[ERROR] Failed to connect:', error);
        process.exit(1);
    }
}

main();
