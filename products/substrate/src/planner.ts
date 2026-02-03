
import { ActionObject, IntentEventObject } from '../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';
import { ObjectStore } from './object_store';

export class Planner {
    private store: ObjectStore | null = null;

    constructor(store: ObjectStore) {
        this.store = store;
    }

    async plan(intent: IntentEventObject): Promise<ActionObject[]> {
        const raw = intent.rawContent.toLowerCase();
        console.log(`[Planner] Planning for intent: ${raw}`);

        // 1. Status / Hello
        if (raw.includes('status') || raw.includes('hello')) {
            return [{
                id: uuidv4(),
                type: 'GET_SYSTEM_STATUS',
                payload: {},
                status: 'READY',
                requiresGesture: false
            }];
        }

        // 2. Scan Temp
        if (raw.includes('scan') && (raw.includes('temp') || raw.includes('tmp'))) {
            return [{
                id: uuidv4(),
                type: 'CREATE_CLEANUP_PLAN',
                payload: {},
                status: 'READY',
                requiresGesture: false
            }];
        }

        // 3. Remote Request Quarantine
        if (raw.startsWith('request quarantine')) {
            const parts = raw.split(' ');
            const planId = parts[2]; // request quarantine <id>
            if (planId) {
                return [{
                    id: uuidv4(),
                    type: 'EXECUTE_CLEANUP_PLAN',
                    payload: { planId, mode: 'QUARANTINE' },
                    status: 'READY', // Wait for gesture confirmation
                    requiresGesture: true
                }];
            }
        }

        // 4. Redaction Test
        if (raw.includes('reveal secret')) {
            return [{
                id: uuidv4(),
                type: 'DEBUG_ECHO',
                payload: { message: "This is a SECRET sequence: sk-1234567890abcdef1234567890" },
                status: 'READY',
                requiresGesture: false
            }];
        }

        // 5. Env Test
        if (raw.includes('reveal env')) {
            return [{
                id: uuidv4(),
                type: 'DEBUG_ECHO',
                payload: { message: `Env var: ${process.env.TELE_TELEGRAM_BOT_TOKEN || 'MISSING'}` },
                status: 'READY',
                requiresGesture: false
            }];
        }

        return [];
    }
}
