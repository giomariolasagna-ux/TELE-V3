
// Executor Stub
import { ActionObject, UpdateObject, UUID, GatewayBridge } from '../../../integrations/gateway_bridge';
import { Scanner, CleanupEngine } from './session_kernel';
import { ObjectStore } from './object_store';
import { SystemScanner } from './nodes/system_scanner';
import { AppNode } from './nodes/app_node';
import { FlowExecutor } from './flows/flow_executor';
import { flowBuilder } from './flows/flow_builder';
import { actionLog } from './agent_fs/action_log';
import { requiresElevation, executeWithAutoElevation } from './runtime/elevated_shell';
import { whatsappAdapter } from './services_hub/whatsapp_adapter';
import { v4 as uuidv4 } from 'uuid';

export class Executor {
    private bridge: GatewayBridge;
    private scanner: Scanner;
    private cleanup: CleanupEngine;
    private store: ObjectStore;
    private onCancel: (() => void) | undefined;

    // Phase 3: Interrupt Controller
    private currentController: AbortController | null = null;

    constructor(bridge: GatewayBridge, store: ObjectStore, onCancel?: () => void) {
        this.bridge = bridge;
        this.store = store;
        this.onCancel = onCancel;
        this.scanner = new Scanner();
        this.cleanup = new CleanupEngine();
    }

    cancelCurrent(metadata: any = {}) {
        if (this.currentController) {
            console.log("[Executor] HARD INTERRUPT TRIGGERED. Aborting current task...");
            this.currentController.abort();
            this.currentController = null;
            if (this.onCancel) this.onCancel();

            // Notify cancellation with metadata (Latency)
            // We can't know the ID of the action we just cancelled easily unless we stored it.
            // But we can broadcast a generic update or just log.
            // For MVP requirement "Display in UI status badge... Telegram completion".
            // If we abort, the 'execute' method catches the AbortError.
            // We should pass metadata to the 'execute' method via... shared state?
            // Or `cancelCurrent` sets a `cancellationReason`.
            this.cancellationMetadata = metadata;
        } else {
            console.log("[Executor] No active task to abort.");
        }
    }

    private cancellationMetadata: any = {};

    async park(action: ActionObject) {
        console.log(`[Executor] Parking Action ${action.id} (Requires Gesture)`);
        await this.store.saveAction(action);

        await this.bridge.sendMessage('console-local', `[PENDING] Action ${action.type} requires confirmation. Use UI or gesture.`);

        await this.bridge.emitUpdate({
            eventId: action.id,
            status: 'READY',
            message: 'Waiting for gesture confirmation'
        });
    }

    async execute(action: ActionObject) {
        console.log(`[Executor] Executing ${action.type}...`);

        // Setup Interrupt Controller
        this.currentController = new AbortController();
        const signal = this.currentController.signal;

        await this.bridge.emitUpdate({
            eventId: action.id,
            status: 'RUNNING',
            progress: 10,
            message: `Starting ${action.type}`
        });

        try {
            if (signal.aborted) throw new Error("Cancelled before start");

            if (action.type === 'GET_SYSTEM_STATUS') {
                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: 'System is healthy. Phase 3 Voice Stack Active.'
                });
                await this.bridge.sendMessage('console-local', "System Status: ONLINE.");
            }
            else if (action.type === 'DEBUG_ECHO') {
                // Redaction check happens in Output Adapter (Gateway), so we send the Secret here to prove Gateway catches it.
                const msg = action.payload.message;
                await this.bridge.sendMessage('console-local', msg);
                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: 'Echo complete'
                });
            }
            else if (action.type === 'CREATE_CLEANUP_PLAN') {
                const plan = await this.scanner.scanSystemTemp();
                await this.store.savePlan(plan);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `Scan complete. Found ${plan.totalBytes} bytes.`
                });

                console.log(`[Executor] Plan ID: ${plan.id}`);
                await this.bridge.sendMessage('console-local',
                    `[PLAN READY] ID: ${plan.id}\nItems: ${plan.items.length}\nBytes: ${plan.totalBytes}\n\nSay 'request quarantine ${plan.id}' to initiate.`
                );
            }
            else if (action.type === 'EXECUTE_CLEANUP_PLAN') {
                const { planId, mode } = action.payload;
                const plan = await this.store.getPlan(planId);

                if (!plan) {
                    throw new Error(`Plan ${planId} not found.`);
                }

                // Execute with Signal
                await this.cleanup.executePlan(plan, mode, async (u) => {
                    if (signal.aborted) throw new Error("INTERRUPTED BY USER");
                    await this.bridge.emitUpdate(u);
                }, signal);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `Cleanup (${mode}) Completed.`
                });

                await this.bridge.sendMessage('console-local', `[SUCCESS] Cleanup finished.`);
            }
            else if (action.type === 'EXECUTE_APP') {
                const { appName, command, args } = action.payload;

                await this.bridge.sendMessage('console-local', `[EXECUTOR] Searching for ${appName}...`);

                // 1. Scan for app
                const scanner = new SystemScanner();
                const drivers = await scanner.scan();

                // Find matching driver (exact first, then fuzzy)
                const appNameLower = appName.toLowerCase();

                // Priority 1: Exact appId match
                let driver = drivers.find(d => d.appId.toLowerCase() === appNameLower);

                // Priority 2: Exact name match
                if (!driver) {
                    driver = drivers.find(d => d.name.toLowerCase() === appNameLower);
                }

                // Priority 3: appId starts with the search term
                if (!driver) {
                    driver = drivers.find(d => d.appId.toLowerCase().startsWith(appNameLower));
                }

                // Priority 4: name contains the search term
                if (!driver) {
                    driver = drivers.find(d => d.name.toLowerCase().includes(appNameLower));
                }

                if (!driver) {
                    throw new Error(`Application '${appName}' not found or not installed.`);
                }

                // 2. Wrap in AppNode
                const appNode = new AppNode(driver);

                // 3. Execute
                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'RUNNING',
                    progress: 50,
                    message: `Launching ${driver.name}...`
                });

                if (command === 'launch') {
                    appNode.setInput('launch', true);
                    await appNode.process();
                } else {
                    appNode.setInput('command', command);
                    appNode.setInput('args', args || {});
                    await appNode.process();
                }

                // Check if node reported error
                const error = appNode.getOutput('error');
                if (error) throw new Error(error);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `${driver.name} executed successfully.`
                });
            }
            else if (action.type === 'SHELL_EXEC') {
                let { command } = action.payload;
                command = command.trim();

                console.log(`[Executor] Raw Command: ${command}`);

                // Clean up LLM hallucinations of "powershell -Command" wrapper
                // Matches "powershell", "powershell.exe", "pwsh", with optional "-Command" or "-c"
                // Case insensitive due to /i
                const wrapperRegex = /^(powershell|pwsh)(\.exe)?\s+(-c(ommand)?\s+)?/i;

                if (wrapperRegex.test(command)) {
                    console.log('[Executor] Detected wrapper, stripping...');
                    command = command.replace(wrapperRegex, '');

                    // Remove wrapping quotes if present (both " and ')
                    // LLM often does: powershell -Command "script"
                    if ((command.startsWith('"') && command.endsWith('"')) ||
                        (command.startsWith("'") && command.endsWith("'"))) {
                        command = command.slice(1, -1);
                    }

                    // Unescape quotes: \" becomes "
                    command = command.replace(/\\"/g, '"');
                    console.log(`[Executor] Sanitized Command: ${command}`);
                }

                // INTERCEPTOR: Store Apps (WhatsApp, Spotify)
                // LLMs often try to launch these via hardcoded EXE paths which fail.
                // We rewrite them to use robust URI schemes.
                if (command.toLowerCase().includes('whatsapp.exe') || command.toLowerCase().includes('whatsapp test')) {
                    // Try to extract existing URI args
                    const uriMatch = command.match(/whatsapp:\/\/[-a-zA-Z0-9+&?=_]+/i);
                    const uri = uriMatch ? uriMatch[0] : 'whatsapp://';

                    console.log(`[Executor] Intercepted WhatsApp launch. Rewriting to URI: ${uri}`);
                    command = `Start-Process "${uri}"`;

                    await this.bridge.sendMessage('console-local', `[INTERCEPTOR] Rewrote command to use WhatsApp URI scheme.`);
                }
                else if (command.toLowerCase().includes('spotify.exe')) {
                    command = `Start-Process "spotify:"`;
                    await this.bridge.sendMessage('console-local', `[INTERCEPTOR] Rewrote command to use Spotify URI scheme.`);
                }

                await this.bridge.sendMessage('console-local', `[SHELL] Executing: ${command}`);

                const { spawn } = require('child_process');

                await new Promise<void>((resolve, reject) => {
                    // Use spawn to avoid User Profile loading (-NoProfile) and ensure clean execution
                    const ps = spawn('powershell.exe', [
                        '-NoProfile',
                        '-NonInteractive',
                        '-ExecutionPolicy', 'ByPass',
                        '-Command', command
                    ]);

                    let stdout = '';
                    let stderr = '';

                    ps.stdout.on('data', (data: any) => {
                        const chunk = data.toString();
                        stdout += chunk;
                        console.log(`[SHELL OUT] ${chunk.trim()}`);
                    });

                    ps.stderr.on('data', (data: any) => {
                        const chunk = data.toString();
                        stderr += chunk;
                        console.warn(`[SHELL ERR] ${chunk.trim()}`);
                    });

                    ps.on('close', async (code: number) => {
                        console.log(`[SHELL] Exited with code ${code}`);

                        // Send full output
                        const output = stdout || stderr || 'No Output';
                        await this.bridge.sendMessage('console-local', `[SHELL RESULT]\n${output.substring(0, 500)}`);
                        resolve();
                    });

                    ps.on('error', (err: any) => {
                        reject(err);
                    });
                });

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: 'Shell command executed successfully'
                });
            }
            // NEW: Execute Flow action type
            else if (action.type === 'EXECUTE_FLOW') {
                const { flowId, flowName, initialData } = action.payload;

                // Find flow by ID or name
                let flow = flowId ? flowBuilder.load(flowId) : flowBuilder.find(flowName);

                if (!flow) {
                    // Try parsing as natural language to create new flow
                    if (flowName) {
                        flow = flowBuilder.parseFromNaturalLanguage(flowName);
                        flowBuilder.save(flow);
                        await this.bridge.sendMessage('console-local', `[FLOW] Created new flow: ${flow.name}`);
                    } else {
                        throw new Error('Flow not found and no name provided to create one');
                    }
                }

                await this.bridge.sendMessage('console-local', `[FLOW] Executing: ${flow.name} (${flow.nodes.length} nodes)`);

                const flowExecutor = new FlowExecutor(this);
                const result = await flowExecutor.execute(flow, initialData);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: result.success ? 'DONE' : 'FAILED',
                    progress: 100,
                    message: result.success
                        ? `Flow completed: ${result.nodeResults.length} nodes in ${result.durationMs}ms`
                        : `Flow failed: ${result.error}`
                });

                if (result.finalOutput) {
                    await this.bridge.sendMessage('console-local', `[FLOW OUTPUT] ${JSON.stringify(result.finalOutput).substring(0, 500)}`);
                }
            }
            // NEW: Send WhatsApp via API
            else if (action.type === 'SEND_WHATSAPP') {
                const { to, message } = action.payload;

                await this.bridge.sendMessage('console-local', `[WhatsApp] Sending to ${to}...`);

                // 1. Ensure connected
                if (!whatsappAdapter.isConnected()) {
                    await this.bridge.sendMessage('console-local', `[WhatsApp] Connecting... Please scan QR code in terminal if needed.`);
                    await whatsappAdapter.connect();
                    // We can't wait indefinitely for QR scan here in this async flow easily without hanging.
                    // For MVP, if not ready, we throw.
                    // But if we just triggered connect, maybe wait a bit?
                    await new Promise(r => setTimeout(r, 3000));
                    if (!whatsappAdapter.isConnected()) {
                        throw new Error('WhatsApp not connected. Please scan QR Code in the backend terminal and try again.');
                    }
                }

                // 2. Resolve Contact
                let recipientId = to;
                // If it doesn't look like an ID (no @c.us), try to find it
                if (!to.includes('@')) {
                    const foundId = await whatsappAdapter.findContact(to);
                    if (foundId) {
                        recipientId = foundId;
                        console.log(`[WhatsApp] Resolved '${to}' to ${recipientId}`);
                    } else {
                        // If standard number, append suffix
                        // Heuristic: if only digits
                        if (/^\d+$/.test(to)) {
                            recipientId = `${to}@c.us`;
                        } else {
                            throw new Error(`Contact '${to}' not found. Try providing the exact phone number.`);
                        }
                    }
                }

                // 3. Send
                await whatsappAdapter.sendMessage(recipientId, message);

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: 'DONE',
                    progress: 100,
                    message: `Message sent to ${action.payload.to}`
                });
            }
            // NEW: Elevated shell execution (admin privileges)
            else if (action.type === 'ELEVATED_SHELL_EXEC') {
                const { command } = action.payload;

                await this.bridge.sendMessage('console-local', `[ELEVATED] Executing with admin privileges...`);

                const result = await executeWithAutoElevation(command);

                await this.bridge.sendMessage('console-local',
                    `[ELEVATED RESULT]\n${result.stdout || result.stderr || 'No output'}`.substring(0, 500));

                await this.bridge.emitUpdate({
                    eventId: action.id,
                    status: result.success ? 'DONE' : 'FAILED',
                    progress: 100,
                    message: result.success ? 'Elevated command completed' : `Failed: ${result.stderr}`
                });
            }
        } catch (e: any) {

            let msg = e.message;
            if (e.message === "INTERRUPTED BY USER" || e.message === "Cancelled before start" || e.message.includes("aborted")) {
                const lat = this.cancellationMetadata?.latencyMs;
                if (lat) msg += ` (Latency: ${lat}ms)`;
            }

            await this.bridge.emitUpdate({
                eventId: action.id,
                status: 'FAILED', // or CANCELLED if we had that status
                message: msg
            });
            this.cancellationMetadata = {}; // Reset
        } finally {
            this.currentController = null;
        }
    }
}
