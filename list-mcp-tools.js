const http = require('http');

const options = {
    hostname: '127.0.0.1',
    port: 3845,
    path: '/mcp',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    }
};

function sendRequest(body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log("Fetching data with grouped requests...");
        const body = JSON.stringify([
            {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: "2024-11-05",
                  capabilities: {},
                  clientInfo: { name: "VeilPay-Builder", version: "1.0.0" }
                }
            },
            {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: {}
            },
            {
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: {
                    name: "get_file",
                    arguments: { file_key: 'B23znVgjyFJcr4YdDAPp1Y' }
                }
            }
        ]);

        const response = await sendRequestCustom(body);
        console.log("RESPONSE:", response);
    } catch (e) {
        console.error(e);
    }
}

function sendRequestCustom(body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

run();