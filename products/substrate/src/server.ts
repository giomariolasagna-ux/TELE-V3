
import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ObjectStore } from './object_store';
import { Executor } from './executor';
import { ActionObject } from '../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';
import { globalEventBus, BusEventType } from './event_bus';
import { LLMService } from './services_hub/llm_service';
import { AgentOrchestrator } from './nodes/agent_orchestrator';
import { voiceLoop } from './voice/voice_loop';
import { TTSService } from './voice/tts_service';

export class SubstrateServer {
    private app: express.Express;
    private server: http.Server;
    private wss: WebSocketServer;
    private port = 3000;
    private store: ObjectStore;
    private executor: Executor;
    private llm: LLMService;
    private orchestrator: AgentOrchestrator;
    private tts: TTSService;

    constructor(store: ObjectStore, executor: Executor) {
        this.store = store;
        this.executor = executor;
        this.app = express();
        this.llm = new LLMService(); // Defaults to local, can be configured via env
        this.orchestrator = new AgentOrchestrator(this.llm);
        this.tts = new TTSService();

        // Configure voice loop handler
        voiceLoop.setTranscriptionHandler(async (text) => {
            await globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                timestamp: Date.now(),
                description: `Voice: Heard "${text}"`
            });
            await this.processInstruction(text);
            return "Comando ricevuto."; // Or a more dynamic response
        });

        // HTTP Server wrap
        this.server = http.createServer(this.app);

        // WebSocket Server
        this.wss = new WebSocketServer({ server: this.server });

        this.app.use(cors());
        this.app.use(express.json());

        this.setupRoutes();
        this.setupWebSockets();
    }

    private setupWebSockets() {
        this.wss.on('connection', async (ws: WebSocket) => {
            console.log('[WS] Client connected');

            // Wait for handshake
            ws.on('message', async (message) => {
                try {
                    const msg = JSON.parse(message.toString());

                    if (msg.type === 'HELLO') {
                        console.log(`[WS] Handshake received. LastEventId: ${msg.lastEventId}`);

                        // 1. Send Snapshot (State)
                        const snapshot = {
                            type: 'SNAPSHOT',
                            payload: {
                                artifacts: await this.store.getAllArtifacts(),
                                actions: await this.store.getAllActions()
                            }
                        };
                        ws.send(JSON.stringify(snapshot));

                        // 2. Replay & Subscribe (Existing logic...)
                        const replayEvents = await this.store.getEventsSince(msg.lastEventId);
                        replayEvents.forEach(evt => {
                            ws.send(JSON.stringify({ type: 'BUS_EVENT', payload: evt }));
                        });

                        const eventHandler = (payload: any) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'BUS_EVENT', payload }));
                            }
                        };
                        globalEventBus.on('event', eventHandler);
                        ws.on('close', () => globalEventBus.off('event', eventHandler));
                        globalEventBus.emitEvent(BusEventType.UI_CONNECTED, { clientId: 'renderer' });

                    } else if (msg.type === 'USER_INPUT') {
                        console.log(`[WS] User Input: ${msg.payload.text}`);
                        await this.processInstruction(msg.payload.text);
                    }

                } catch (e) {
                    console.error('[WS] Error processing message', e);
                }
            });
        });
    }

    // Basic NLP / Command Router
    private async processInstruction(text: string) {
        // 1. Send to Hive Mind (Orchestrator)
        const result = await this.orchestrator.processRequest(text);

        if (result) {
            console.log('[Server] Orchestrator Raw Result:', JSON.stringify(result, null, 2));

            // Normalize to Array
            const actions = Array.isArray(result) ? result : [result];

            for (const item of actions) {
                // Normalize Structure (LLM can be messy)
                // Expectation: { type: '...', payload: {...} }
                // Reality can be: { action: '...', appName: '...', ... }

                let finalType = item.type || item.action || 'UNKNOWN';

                // Orchestrator often returns 'params' or 'payload'
                let finalPayload = item.payload || item.params || item;

                // Should remove 'type'/'action' from payload if it was flat
                if (finalPayload === item) {
                    const { type, action, ...rest } = item;
                    finalPayload = rest;
                }

                const actionObj: ActionObject = {
                    id: uuidv4(),
                    type: finalType,
                    payload: finalPayload,
                    requiresGesture: false,
                    status: 'PLANNED'
                };

                await globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                    timestamp: Date.now(),
                    description: `Hive: Executing ${finalType}`
                });

                // Execute sequentially
                try {
                    await this.executor.execute(actionObj);
                } catch (e) {
                    console.error(`[Server] Action ${finalType} failed:`, e);
                }
            }
            return;
        }

        // 2. Fallback execution...
        console.warn('[Server] No Result from Orchestrator? Fallback.');
        const lower = text.toLowerCase();

        let actionType = 'UNKNOWN';
        let payload: any = {};

        if (lower.includes('status') || lower.includes('hello')) {
            actionType = 'GET_SYSTEM_STATUS';
        }
        else if (lower.includes('clean') || lower.includes('scan')) {
            if (lower.includes('execute') || lower.includes('run')) {
                actionType = 'CREATE_CLEANUP_PLAN';
            } else {
                actionType = 'CREATE_CLEANUP_PLAN';
            }
        }
        else if (lower.startsWith('launch ') || lower.startsWith('open ')) {
            const appName = lower.replace('launch ', '').replace('open ', '').trim();
            actionType = 'EXECUTE_APP';
            payload = { appName, command: 'launch' };
        }
        else if (lower.startsWith('play uri ')) {
            const uri = lower.replace('play uri ', '').trim();
            actionType = 'EXECUTE_APP';
            payload = { appName: 'spotify', command: 'play_uri', args: { uri } };
        }
        else if (lower.includes('crea flow') || lower.includes('create flow') || lower.includes('create a flow')) {
            // Natural Language Flow Creation Fallback
            // e.g. "Crea flow: apri notepad, aspetta 5s, chiudi"
            const description = text.replace(/^.*?(crea flow|create flow|create a flow)[:\s]*/i, '').trim();
            actionType = 'EXECUTE_FLOW';
            // Executor will parse this as natural language if no ID is provided
            payload = { flowName: description };
        }

        if (actionType !== 'UNKNOWN') {
            const action: ActionObject = {
                id: uuidv4(),
                type: actionType,
                payload,
                requiresGesture: false,
                status: 'PLANNED'
            };
            this.executor.execute(action).catch(console.error);
        } else {
            await globalEventBus.emitEvent(BusEventType.TIMELINE_EVENT, {
                timestamp: Date.now(),
                description: `Agent: I don't know how to "${text}" yet (and AI failed).`
            });
        }
    }

    private setupRoutes() {
        this.app.post('/actions/execute', async (req, res) => {
            const { actionType, payload, gestureProof } = req.body;
            console.log(`[API] Request execute: ${actionType} with proof`, gestureProof);

            const action: ActionObject = {
                id: uuidv4(),
                type: actionType,
                payload,
                requiresGesture: true,
                status: 'PLANNED'
            };

            this.executor.execute(action).catch(err => console.error(err));
            res.json({ status: 'ACCEPTED', actionId: action.id });
        });

        // Voice Routes
        this.app.post('/voice/speak', async (req, res) => {
            const { text, voice } = req.body;
            console.log(`[API] Voice Speak: ${text}`);
            this.tts.speak(text, voice || 'af_heart').catch(console.error);
            res.json({ status: 'OK' });
        });

        this.app.post('/voice/start-loop', async (req, res) => {
            console.log('[API] Starting Voice Loop');
            voiceLoop.startListening().catch(console.error);
            res.json({ status: 'OK' });
        });

        this.app.post('/voice/stop-loop', (req, res) => {
            console.log('[API] Stopping Voice Loop');
            voiceLoop.stopListening();
            res.json({ status: 'OK' });
        });
    }
    async start() {
        const preferredPort = Number(process.env.TELE_RUNTIME_PORT) || 3000;
        this.port = preferredPort;

        // Security: Session Nonce (Optional for WS if local, but good practice)
        // For Phase 10 MVP we are skipping complex WS auth for local usage
        const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const runtimeDir = path.join(os.homedir(), '.tele', 'runtime');

        fs.mkdirSync(runtimeDir, { recursive: true });

        // Write Port & Nonce
        fs.writeFileSync(path.join(runtimeDir, 'port.json'), JSON.stringify({ port: this.port }));
        fs.writeFileSync(path.join(runtimeDir, 'nonce.txt'), nonce);

        return new Promise<void>((resolve, reject) => {
            // Listen on the HTTP server instance, not app.listen
            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`[SubstrateServer] UI API & WS listening on http://127.0.0.1:${this.port}`);

                // Write Port File
                fs.writeFileSync(path.join(runtimeDir, 'port.json'), JSON.stringify({ port: this.port }));

                // Run Boot Pipeline
                const { BootPipeline } = require('./boot_pipeline');
                new BootPipeline().run();

                resolve();
            });

            this.server.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`Port ${this.port} busy, trying ${this.port + 1}`);
                    this.port++;
                    this.server.listen(this.port); // Simplistic retry
                } else {
                    reject(err);
                }
            });
        });
    }
}
