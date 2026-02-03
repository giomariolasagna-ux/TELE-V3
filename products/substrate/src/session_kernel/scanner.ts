
import { CleanupPlanObject, CleanupItem } from '../../../../integrations/gateway_bridge';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Safety caps
const MAX_SCAN_FILES = 100;
const MAX_SCAN_TIME_MS = 2000;

export class Scanner {

    async scanSystemTemp(): Promise<CleanupPlanObject> {
        const startTime = Date.now();
        const items: CleanupItem[] = [];
        let totalBytes = 0;

        // Determine targets safely
        const targets = [
            os.tmpdir(), // %TEMP%
            path.join(process.cwd(), '.tele', 'workspaces') // Project local
        ];

        // Unique and Existent Targets only
        const uniqueTargets = [...new Set(targets)].filter(t => fs.existsSync(t));

        console.log(`[Scanner] Targets: ${uniqueTargets.join(', ')}`);

        for (const target of uniqueTargets) {
            try {
                const files = fs.readdirSync(target); // Sync for MVP stability, ideal async
                for (const file of files) {
                    // Check Limits
                    if (items.length >= MAX_SCAN_FILES) break;
                    if (Date.now() - startTime > MAX_SCAN_TIME_MS) break;

                    const fullPath = path.join(target, file);
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.isFile()) {
                            // Categorize (Simple heuristics)
                            let category: CleanupItem['category'] = 'UNKNOWN';
                            if (file.endsWith('.tmp') || file.endsWith('.temp')) category = 'TEMP';
                            else if (file.endsWith('.log')) category = 'LOG';
                            else if (file.includes('cache')) category = 'CACHE';

                            // Heuristic Risk Assessment
                            // .log is usually safe. .tmp is messy.
                            // If it's effectively system temp, risk is LOW usually, but we treat as MEDIUM if unknown ext.
                            let risk: CleanupItem['riskLevel'] = 'LOW';
                            if (fullPath.includes('Administrator') && !fullPath.includes('.tele')) {
                                // User files are potentially sensitive
                                risk = 'MEDIUM';
                            }

                            items.push({
                                path: fullPath,
                                sizeBytes: stats.size,
                                category,
                                riskLevel: risk
                            });
                            totalBytes += stats.size;
                        }
                    } catch (e) {
                        // Access denied, skip silently
                    }
                }
            } catch (e) {
                console.warn(`[Scanner] Failed to scan target ${target}: ${e}`);
            }
        }

        return {
            id: uuidv4(),
            createdAt: new Date().toISOString(),
            items,
            totalBytes,
            recommendedAction: 'QUARANTINE',
            status: 'PLANNED'
        };
    }
}
