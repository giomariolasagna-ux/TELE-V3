
import { WorkspaceObject } from '../../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const TELE_ROOT = path.join(process.cwd(), '.tele');
const WORKSPACES_ROOT = path.join(TELE_ROOT, 'workspaces');
const SESSIONS_ROOT = path.join(WORKSPACES_ROOT, 'sessions');

export class WorkspaceManager {
    private activeWorkspace: WorkspaceObject | null = null;

    constructor() {
        this.ensureRoots();
    }

    private ensureRoots() {
        if (!fs.existsSync(SESSIONS_ROOT)) {
            fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
        }
    }

    async startSession(mode: 'LIGHT' | 'DEV' | 'CREATIVE' | 'AI' = 'LIGHT'): Promise<WorkspaceObject> {
        const sessionId = uuidv4();
        const sessionPath = path.join(SESSIONS_ROOT, sessionId);

        fs.mkdirSync(sessionPath, { recursive: true });

        // Create standard folders
        fs.mkdirSync(path.join(sessionPath, 'temp'));
        fs.mkdirSync(path.join(sessionPath, 'logs'));
        fs.mkdirSync(path.join(sessionPath, 'scratch'));

        this.activeWorkspace = {
            id: uuidv4(),
            sessionId,
            path: sessionPath,
            mode,
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };

        console.log(`[WorkspaceManager] Started session ${sessionId} at ${sessionPath}`);
        return this.activeWorkspace;
    }

    async endSession(): Promise<void> {
        if (this.activeWorkspace) {
            this.activeWorkspace.status = 'ARCHIVED';
            // In MVP we don't delete immediately, just mark archived.
            console.log(`[WorkspaceManager] Ended session ${this.activeWorkspace.sessionId}`);
            this.activeWorkspace = null;
        }
    }

    getActiveWorkspace(): WorkspaceObject | null {
        return this.activeWorkspace;
    }

    getSessionTempPath(): string | null {
        if (!this.activeWorkspace) return null;
        return path.join(this.activeWorkspace.path, 'temp');
    }
}
