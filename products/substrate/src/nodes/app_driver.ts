// App Node Driver Interface
// Interface for application-specific drivers (Chrome, Word, etc.)

export interface AppDriver {
    name: string;
    appId: string; // e.g., 'chrome', 'word', 'photoshop'
    isInstalled(): Promise<boolean>;
    launch(): Promise<void>;
    execute(command: string, args?: any): Promise<any>;
    close(): Promise<void>;
}
