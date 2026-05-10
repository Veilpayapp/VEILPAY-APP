const http = require('http');
const fs = require('fs');

const FIGMA_FILE_ID = 'B23znVgjyFJcr4YdDAPp1Y';
const MCP_PORT = 3845;

async function fetchFigmaData() {
    console.log('Connecting to local Figma MCP at http://127.0.0.1:' + MCP_PORT + '/mcp...');

    const postData = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
            name: "get_file",
            arguments: { file_key: FIGMA_FILE_ID }
        }
    });

    const options = {
        hostname: '127.0.0.1',
        port: MCP_PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                    console.error('MCP Error:', JSON.stringify(parsed.error, null, 2));
                    fs.writeFileSync('figma-error.log', data);
                } else {
                    fs.writeFileSync('figma-dump.json', JSON.stringify(parsed, null, 2));
                    console.log('✓ Designs extracted to figma-dump.json');
                }
            } catch (e) {
                console.error('Parse Error:', e.message);
                fs.writeFileSync('figma-error.log', data);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Request Error:', e.message);
    });

    req.write(postData);
    req.end();
}

fetchFigmaData();
