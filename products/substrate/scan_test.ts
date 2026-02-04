// System Scan Test

import { SystemScanner } from './src/nodes/system_scanner';

async function main() {
    console.log('--- Initializing Scanner ---');
    const scanner = new SystemScanner();

    console.log('--- Scanning System ---');
    const drivers = await scanner.scan();

    console.log('\n--- Scan Results ---');
    if (drivers.length === 0) {
        console.log('No supported apps found.');
    } else {
        drivers.forEach(d => {
            console.log(`✅ [Available] ${d.name} (${d.appId})`);
        });
    }
}

main().catch(console.error);
