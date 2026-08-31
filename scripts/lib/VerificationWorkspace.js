'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('node:child_process');
const { stopProcessTree } = require('../evaluation/process');
const { withTimeout } = require('../../tests/helpers/network');
const { verificationError } = require('./verificationError');

/** Owns one newly created verification directory and its sequential commands. */
class VerificationWorkspace {
    constructor() {
        this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-package-check-'));
        this.cleanupFailure = null;
    }

    async command(args, { cwd = this.directory, environment = {}, timeoutMs = 120000, executable = process.execPath, rejectTruncatedOutput = false } = {}) {
        if (this.cleanupFailure) throw this.cleanupFailure;
        const child = spawn(executable, args, { cwd, env: { ...process.env, NODE_PATH: '', ...environment }, shell: false,
            stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
        let stdout = '', stderr = '', launchError, truncated = false;
        const retain = (current, chunk) => {
            const output = current + chunk;
            if (output.length > 1024 * 1024) truncated = true;
            return output.slice(-1024 * 1024);
        };
        child.stdout.on('data', chunk => { stdout = retain(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = retain(stderr, chunk); });
        child.once('error', error => { launchError = error; });
        const closed = new Promise(resolve => child.once('close', resolve));
        let code;
        try {
            code = await withTimeout(closed, 'package verification command', timeoutMs);
        } catch (error) {
            const primary = new Error(`${error.message}\n${stdout}${stderr}`, { cause: error });
            try {
                await stopProcessTree(child);
                await withTimeout(closed, 'package command exit', 5000);
            } catch (cleanup) {
                this.cleanupFailure = new AggregateError([primary, cleanup], primary.message, { cause: primary });
                // A surviving descendant may own the other ends of these pipes.
                // Releasing our handles permits verifier exit; it is not cleanup.
                child.stdout.destroy();
                child.stderr.destroy();
                child.unref();
                throw this.cleanupFailure;
            }
            throw primary;
        }
        if (launchError || code !== 0) {
            throw new Error(`Package verification command failed (${code}): ${launchError?.message || ''}\n${stdout}${stderr}`, { cause: launchError });
        }
        if (rejectTruncatedOutput && truncated) throw new Error('Package verification command output was truncated.');
        return stdout;
    }

    async run(operation) {
        let result, failure;
        try { result = await operation(this); }
        catch (error) { failure = verificationError(error); }
        if (this.cleanupFailure) {
            failure = failure && failure !== this.cleanupFailure
                ? new AggregateError([failure, this.cleanupFailure], failure.message, { cause: failure }) : this.cleanupFailure;
        } else {
            try { await fs.promises.rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
            catch (cleanup) {
                failure = failure ? new AggregateError([failure, cleanup], failure.message, { cause: failure }) : cleanup;
            }
        }
        if (failure) {
            if (fs.existsSync(this.directory)) failure.retainedWorkspace = this.directory;
            throw failure;
        }
        return result;
    }
}

module.exports = { VerificationWorkspace };
