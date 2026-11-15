export interface SystemStats {
    cpuTotal: number;
    cpuIdle: number;
    memoryTotal: number;
    memoryUsed: number;
    uptime: number;
    load: number;
}

export function formatDuration(milliseconds: number): string {
    const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const rest = seconds % 60;
    return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function parseSystemStats(cpu: string, memory: string, uptime: string, load: string): SystemStats {
    const counters = cpu.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const fields = Object.fromEntries(memory.split('\n').filter(line => line.includes(':')).map(line => {
        const [name, value] = line.split(':');
        return [name, (Number.parseFloat(value) || 0) * 1024];
    }));
    const total = fields.MemTotal ?? 0;
    const available = fields.MemAvailable ?? fields.MemFree ?? 0;
    return {
        cpuTotal: counters.slice(0, 8).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0),
        cpuIdle: (counters[3] ?? 0) + (counters[4] ?? 0),
        memoryTotal: total,
        memoryUsed: Math.max(0, total - available),
        uptime: Number.parseFloat(uptime) || 0,
        load: Number.parseFloat(load) || 0,
    };
}

export function formatBytes(value: number): string {
    const bytes = Math.max(0, Number(value) || 0);
    const units = ['o', 'Kio', 'Mio', 'Gio', 'Tio'];
    const index = bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
    return `${(bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}