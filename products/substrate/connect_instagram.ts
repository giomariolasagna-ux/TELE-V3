// Instagram Connection Script
// Run this to connect your Instagram Business/Creator account

import { instagramAdapter } from './src/services_hub/instagram_adapter';

async function main() {
    console.log('===========================================');
    console.log('   TELE Antigravity - Instagram Setup');
    console.log('===========================================\n');
    console.log('This will authenticate your Instagram account.');
    console.log('Note: Requires Business or Creator account.\n');

    try {
        await instagramAdapter.connect();

        // Test the connection
        const profile = await instagramAdapter.getUserProfile();
        if (profile) {
            console.log(`Connected as: @${profile.username} (ID: ${profile.id})`);
        }

        // List recent media
        const media = await instagramAdapter.getRecentMedia(5);
        if (media.length > 0) {
            console.log('\nRecent posts:');
            media.forEach((m: any) => {
                const caption = m.caption?.slice(0, 50) || '(no caption)';
                console.log(`  - [${m.media_type}] ${caption}...`);
            });
        }

        console.log('\n✅ Instagram integration is working!');
    } catch (error: any) {
        console.error('Error:', error.message);
    }

    process.exit(0);
}

main();
