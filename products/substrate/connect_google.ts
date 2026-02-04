// Google OAuth Connection Script
// Run this to authenticate with Google

import { googleAdapter } from './src/services_hub/google_adapter';

async function main() {
    console.log('===========================================');
    console.log('   TELE Antigravity - Google OAuth Setup');
    console.log('===========================================\n');

    try {
        await googleAdapter.connect();

        // Test the connection
        const userInfo = await googleAdapter.getUserInfo();
        if (userInfo) {
            console.log(`Logged in as: ${userInfo.name} (${userInfo.email})`);
        }

        // List Gmail labels as a test
        const labels = await googleAdapter.listGmailLabels();
        console.log(`Gmail labels: ${labels.slice(0, 5).join(', ')}...`);

        // List upcoming calendar events
        const events = await googleAdapter.listCalendarEvents(3);
        if (events.length > 0) {
            console.log('\nUpcoming events:');
            events.forEach((e: any) => {
                const start = e.start?.dateTime || e.start?.date;
                console.log(`  - ${e.summary} (${start})`);
            });
        }

        console.log('\n✅ Google integration is working!');
    } catch (error: any) {
        console.error('Error:', error.message);
    }

    process.exit(0);
}

main();
