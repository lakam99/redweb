'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { withTimeout } = require('../../tests/helpers/network');

// Run npm through Node directly so we retain the build process tree on timeout.
function npmEntrypoint() {
    const candidates = [process.env.npm_execpath,
        path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
        path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
    const entry = candidates.find(candidate => candidate && fs.existsSync(candidate));
    if (!entry) throw new Error('Cannot locate npm-cli.js; run the evaluator through npm or install npm beside Node.');
    return entry;
}

async function runBuild(root, timeoutMs = 60000) {
    const report = { startedAt: new Date().toISOString(), stdout: '', stderr: '', exitCode: null };
    const child = spawnManaged([npmEntrypoint(), 'run', 'build'], { cwd: root });
    child.stdout.on('data', chunk => { report.stdout = (report.stdout + chunk).slice(-1024 * 1024); });
    child.stderr.on('data', chunk => { report.stderr = (report.stderr + chunk).slice(-1024 * 1024); });
    const closed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => { report.exitCode = code; resolve(); });
    });
    try { await withTimeout(closed, 'production build', timeoutMs); }
    catch (error) {
        report.error = error.message;
        if (child.pid) {
            await stopProcessTree(child);
            await withTimeout(closed, 'build exit', 5000);
        }
    }
    report.endedAt = new Date().toISOString();
    return report;
}

function spawnManaged(args, options) {
    return spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        detached: process.platform !== 'win32', ...options });
}

async function stopProcessTree(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await withTimeout(new Promise((resolve, reject) => { killer.once('error', reject); killer.once('close', resolve); }), 'process tree cleanup', 5000);
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await withTimeout(exited, 'process exit', 5000);
}

function listenerAddresses(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid listener port.');
    if (process.platform !== 'win32') throw new Error('Independent listener-interface inspection currently requires Windows; do not claim loopback verification on this platform.');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -ExpandProperty LocalAddress) | ConvertTo-Json -Compress`],
    { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    const addresses = JSON.parse(output);
    return Array.isArray(addresses) ? addresses : [addresses];
}

module.exports = { runBuild, npmEntrypoint, spawnManaged, stopProcessTree, listenerAddresses };
