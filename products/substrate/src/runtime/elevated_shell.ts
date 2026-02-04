/**
 * Elevated Shell - UAC Elevation Wrapper for Privileged Operations
 * Handles registry modifications, system services, and admin-level commands
 */

import { spawn } from 'child_process';
import { actionLog } from '../agent_fs/action_log';
import { v4 as uuidv4 } from 'uuid';

export interface ElevatedCommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    elevated: boolean;
}

/**
 * Check if a command requires elevation
 */
export function requiresElevation(command: string): boolean {
    const lower = command.toLowerCase();

    // Registry operations
    if (lower.includes('reg add') || lower.includes('reg delete') ||
        lower.includes('set-itemproperty hklm') || lower.includes('new-itemproperty hklm') ||
        lower.includes('remove-itemproperty hklm')) {
        return true;
    }

    // Service operations
    if (lower.includes('sc config') || lower.includes('sc stop') || lower.includes('sc start') ||
        lower.includes('stop-service') || lower.includes('start-service') ||
        lower.includes('set-service')) {
        return true;
    }

    // System file operations
    if (lower.includes('c:\\windows\\system32') || lower.includes('c:\\windows\\syswow64') ||
        lower.includes('%systemroot%')) {
        return true;
    }

    // Disk/partition operations
    if (lower.includes('diskpart') || lower.includes('format') || lower.includes('chkdsk')) {
        return true;
    }

    // Firewall rules
    if (lower.includes('netsh advfirewall') || lower.includes('new-netfirewallrule')) {
        return true;
    }

    // User/group management
    if (lower.includes('net user') || lower.includes('net localgroup') ||
        lower.includes('add-localgroupmember') || lower.includes('new-localuser')) {
        return true;
    }

    return false;
}

/**
 * Execute a command with UAC elevation
 */
export async function executeElevated(command: string): Promise<ElevatedCommandResult> {
    const startTime = Date.now();

    console.log('[ElevatedShell] Executing with elevation:', command.substring(0, 100));

    // Create a temporary script file
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const scriptPath = path.join(os.tmpdir(), `tele_elevated_${Date.now()}.ps1`);
    const outputPath = path.join(os.tmpdir(), `tele_elevated_output_${Date.now()}.txt`);
    const errorPath = path.join(os.tmpdir(), `tele_elevated_error_${Date.now()}.txt`);

    // Script that runs the command and captures output
    const script = `
        try {
            $output = Invoke-Expression -Command @'
${command}
'@
            $output | Out-File -FilePath "${outputPath.replace(/\\/g, '\\\\')}" -Encoding UTF8
        } catch {
            $_.Exception.Message | Out-File -FilePath "${errorPath.replace(/\\/g, '\\\\')}" -Encoding UTF8
            exit 1
        }
        exit 0
    `;

    fs.writeFileSync(scriptPath, script, 'utf8');

    return new Promise((resolve) => {
        // Use Start-Process -Verb RunAs for elevation
        const elevationScript = `
            Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"${scriptPath.replace(/\\/g, '\\\\')}"' -Verb RunAs -Wait -WindowStyle Hidden
        `;

        const ps = spawn('powershell', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', elevationScript
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ps.on('close', (exitCode) => {
            // Read output files
            try {
                if (fs.existsSync(outputPath)) {
                    stdout = fs.readFileSync(outputPath, 'utf8');
                    fs.unlinkSync(outputPath);
                }
            } catch (e) { }

            try {
                if (fs.existsSync(errorPath)) {
                    stderr = fs.readFileSync(errorPath, 'utf8');
                    fs.unlinkSync(errorPath);
                }
            } catch (e) { }

            // Clean up script
            try {
                fs.unlinkSync(scriptPath);
            } catch (e) { }

            const result: ElevatedCommandResult = {
                success: exitCode === 0 && !stderr,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                elevated: true
            };

            // Log the action
            actionLog.log({
                id: uuidv4(),
                timestamp: startTime,
                type: 'ELEVATED_SHELL_EXEC',
                payload: { command: command.substring(0, 200) },
                result: result.success ? 'success' : 'failure',
                latencyMs: Date.now() - startTime,
                error: result.stderr || undefined,
                context: { elevated: true, exitCode }
            });

            resolve(result);
        });

        ps.on('error', (error) => {
            resolve({
                success: false,
                stdout: '',
                stderr: error.message,
                exitCode: null,
                elevated: false
            });
        });
    });
}

/**
 * Execute a command, elevating if necessary
 */
export async function executeWithAutoElevation(command: string): Promise<ElevatedCommandResult> {
    if (requiresElevation(command)) {
        console.log('[ElevatedShell] Command requires elevation');
        return executeElevated(command);
    }

    // Run normally without elevation
    return new Promise((resolve) => {
        const startTime = Date.now();

        const ps = spawn('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', command
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => stdout += data);
        ps.stderr.on('data', (data) => stderr += data);

        ps.on('close', (exitCode) => {
            const result: ElevatedCommandResult = {
                success: exitCode === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                elevated: false
            };

            actionLog.log({
                id: uuidv4(),
                timestamp: startTime,
                type: 'SHELL_EXEC',
                payload: { command: command.substring(0, 200) },
                result: result.success ? 'success' : 'failure',
                latencyMs: Date.now() - startTime,
                error: result.stderr || undefined
            });

            resolve(result);
        });

        ps.on('error', (error) => {
            resolve({
                success: false,
                stdout: '',
                stderr: error.message,
                exitCode: null,
                elevated: false
            });
        });
    });
}

/**
 * Registry helper - set a value
 */
export async function setRegistryValue(
    keyPath: string,
    valueName: string,
    value: string | number,
    type: 'REG_SZ' | 'REG_DWORD' | 'REG_QWORD' | 'REG_EXPAND_SZ' = 'REG_SZ'
): Promise<ElevatedCommandResult> {
    const psType = {
        'REG_SZ': 'String',
        'REG_DWORD': 'DWord',
        'REG_QWORD': 'QWord',
        'REG_EXPAND_SZ': 'ExpandString'
    }[type];

    const command = `Set-ItemProperty -Path "${keyPath}" -Name "${valueName}" -Value ${typeof value === 'string' ? `"${value}"` : value} -Type ${psType}`;
    return executeWithAutoElevation(command);
}

/**
 * Registry helper - get a value
 */
export async function getRegistryValue(keyPath: string, valueName: string): Promise<string | null> {
    const command = `(Get-ItemProperty -Path "${keyPath}" -Name "${valueName}" -ErrorAction SilentlyContinue).${valueName}`;
    const result = await executeWithAutoElevation(command);
    return result.success ? result.stdout : null;
}
