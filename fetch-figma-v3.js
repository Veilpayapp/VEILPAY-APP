const http = require('http');
const fs = require('fs');

const FIGMA_FILE_ID = 'B23znVgjyFJcr4YdDAPp1Y';
const MCP_PORT = 3845;

async function fetchFigmaData() {
    console.log('Connecting to local Figma MCP at http://127.0.0.1:' + MCP_PORT + '/mcp...');

    const options = {
        hostname: '127.0.0.1',
        port: MCP_PORT,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const batchRequest = JSON.stringify([
        {
            jsonrpc: "2.0",
            id: "init-1",
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "VeilPay-Builder", version: "1.0.0" }
            }
        },
        {
            jsonrpc: "2.0",
            id: "tool-1",
            method: "tools/call",
            params: {
                name: "get_file",
                arguments: { file_key: FIGMA_FILE_ID }
            }
        }
    ]);

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            try {
                const results = JSON.parse(body);
                console.log('✓ Received response. Processing...');

                // The response should be an array because we sent a batch
                if (!Array.isArray(results)) {
                    console.error('Expected batch response, got:', results);
                    return;
                }

                const toolResult = results.find(r => r.id === "tool-1");
                if (toolResult && toolResult.error) {
                    console.error('MCP Tool Error:', JSON.stringify(toolResult.error, null, 2));
                } else if (toolResult) {
                    fs.writeFileSync('figma-dump.json', JSON.stringify(toolResult.result, null, 2));
                    console.log('✓ Designs saved to figma-dump.json');
                } else {
                    console.error('Tool result not found in batch response');
                }
            } catch (e) {
                console.error('Final Parse Error:', e.message);
                console.log('Raw Response:', body);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Request Error:', e.message);
    });

    req.write(batchRequest);
    req.end();
}

fetchFigmaData();
