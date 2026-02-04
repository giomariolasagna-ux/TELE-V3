// Test Script for Node Architecture

import { MoonshotNode } from './src/nodes/moonshot_node';
import { AppNode } from './src/nodes/app_node';
import { LinkWordDriver } from './src/nodes/apps/office_driver';
import { DropspaceIngestor } from './src/dropspace/ingestor';

async function main() {
    console.log('=== Testing Moonshot Node (HTTP) ===');
    const httpNode = new MoonshotNode();

    // Config: Call a public IP echo service
    httpNode.setInput('url', 'https://httpbin.org/get');
    httpNode.setInput('method', 'GET');

    await httpNode.process();

    console.log('Status:', httpNode.getOutput('status'));
    if (httpNode.getOutput('status') === 200) {
        console.log('✅ Moonshot Node works!');
    } else {
        console.error('❌ Moonshot Node failed:', httpNode.getOutput('error'));
    }

    console.log('\n=== Testing Dropspace Ingestion ===');
    const ingestor = new DropspaceIngestor();
    const nodes = await ingestor.ingest({
        type: 'url',
        content: 'https://api.openai.com/v1/models',
        name: 'OpenAI API'
    });

    if (nodes.length > 0 && nodes[0] instanceof MoonshotNode) {
        console.log(`✅ Dropspace successfully created ${nodes.length} node(s)`);
        console.log(`Node Type: ${nodes[0].type}`);
        console.log(`Configured URL: ${nodes[0].inputs.get('url')?.value}`);
    } else {
        console.error('❌ Dropspace failed to create nodes');
    }

    console.log('\n=== Testing App Node (Word) ===');
    const wordDriver = new LinkWordDriver();
    const wordNode = new AppNode(wordDriver);

    // 1. Launch Word
    console.log('Action: Launching Word...');
    wordNode.setInput('launch', true);
    await wordNode.process();
    wordNode.setInput('launch', false); // Reset trigger

    // 2. Write Text
    console.log('Action: Writing text...');
    wordNode.setInput('command', 'write_text');
    wordNode.setInput('args', { text: 'Hello from Antigravity Nodes!\nThis was typed by an Agent.' });
    await wordNode.process();

    console.log('✅ App Node execution completed. Check your Word window!');

    // Keep it open for user to see
    // await wordDriver.close();
}

main().catch(console.error);
