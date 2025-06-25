// src/debug-bootstrap/bootstrap.js

/**
 * This script acts as a bridge between the VS Code extension and the Jest process.
 * 1. It is started by Node with the --inspect flag.
 * 2. It waits for a specific message ('runJestTests') from the parent process (the Debug Adapter).
 * 3. Once the message is received, it loads and runs the actual Jest test file.
 *
 * This allows the extension to attach the debugger *before* any test code is run,
 * without pausing on an arbitrary first line.
 */

// The first argument passed to this script is the actual path to Jest's CLI script.
const jestCliPath = process.argv[2];

// All subsequent arguments are meant for Jest.
const jestArgs = process.argv.slice(3);

let hasRun = false;

/**
 * Loads the Jest CLI module and effectively transfers control to it.
 * Node's `require` on a script will execute it.
 */
function runJest() {
    if (hasRun) {
        return;
    }
    hasRun = true;

    // Set the arguments for the Jest process.
    // We overwrite process.argv so that Jest's internals parse the correct arguments.
    process.argv = ['node', jestCliPath, ...jestArgs];

    // By requiring the Jest CLI script, we start Jest within this same process.
    console.log(`[Bootstrap] Received run command. Starting Jest from: ${jestCliPath}`);
    require(jestCliPath);
}

// Listen for messages from the parent process (the Debug Adapter controlled by VS Code).
process.on('message', (message) => {
    console.log('[Bootstrap] Received message:', message);
    // We wait for the custom command that our extension will send.
    if (message && message.command === 'runJestTests') {
        console.log('[Bootstrap] runJestTests command received, starting Jest...');
        runJest();
    } else {
        console.log('[Bootstrap] Unknown message received:', message);
    }
});

// A fallback timeout in case the message never arrives, to prevent zombie processes.
setTimeout(() => {
    if (!hasRun) {
        console.error('[Bootstrap] Timed out waiting for runJestTests command. Terminating.');
        process.exit(1);
    }
}, 30000); // 30-second timeout

console.log('[Bootstrap] Ready and waiting for debugger to attach and send run command...');
