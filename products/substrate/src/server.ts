
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

export class SubstrateServer {
    private app: express.Express;
    private server: http.Server;
    private wss: WebSocketServer;
    private port = 3000;
    private store: ObjectStore;
    private executor: Executor;

    constructor(store: ObjectStore, executor: Executor) {
        this.store = store;
        this.executor = executor;
        this.app = express();

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

                        // 2. Replay missing events
                        const replayEvents = await this.store.getEventsSince(msg.lastEventId);
                        console.log(`[WS] Replaying ${replayEvents.length} events`);

                        replayEvents.forEach(evt => {
                            ws.send(JSON.stringify({
                                type: 'BUS_EVENT',
                                payload: evt
                            }));
                        });

                        // 3. Subscribe to live events
                        const eventHandler = (payload: any) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'BUS_EVENT',
                                    payload
                                }));
                            }
                        };
                        globalEventBus.on('event', eventHandler);

                        ws.on('close', () => {
                            globalEventBus.off('event', eventHandler);
                        });

                        // Emit UI connection event
                        globalEventBus.emitEvent(BusEventType.UI_CONNECTED, { clientId: 'renderer' });
                    }
                } catch (e) {
                    console.error('[WS] Error processing message', e);
                }
            });
        });
    }

    private setupRoutes() {
        this.app.get('/objects', async (req, res) => {
            const actions = await this.store.getAllActions();
            const plans = await this.store.getAllPlans();
            // Combine or filter based on query
            res.json({ actions, plans });
        });

        this.app.get('/workspace', async (req, res) => {
            const ws = await this.store.getCurrentWorkspace();
            res.json(ws || { status: 'NO_SESSION' });
        });

        this.app.post('/actions/execute', async (req, res) => {
            const { actionType, payload, gestureProof } = req.body;

            console.log(`[API] Request execute: ${actionType} with proof`, gestureProof);

            // Phase 10: Free Mode check in Executor, but here we might skip gesture proof check
            // For now, we respect the "TELE_FREE_MODE" env if set, but Executor handles logic.

            // Construct Action
            const action: ActionObject = {
                id: uuidv4(),
                type: actionType,
                payload,
                requiresGesture: true,
                status: 'PLANNED'
            };

            // Execute async
            this.executor.execute(action).catch(err => console.error(err));

            res.json({ status: 'ACCEPTED', actionId: action.id });
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
