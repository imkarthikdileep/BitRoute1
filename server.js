const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8081 });

const peers = new Map(); // Track peers by ID

wss.on('connection', ws => {
    const peerId = Math.random().toString(36).substring(2, 8); // Generate a 6-character ID
    peers.set(peerId, ws);
    ws.send(JSON.stringify({ type: 'id', peerId }));

    ws.on('message', message => {
        const data = JSON.parse(message);
        if (data.to) {
            const target = peers.get(data.to);
            if (target) {
                target.send(JSON.stringify({ from: peerId, ...data }));
            }
        }
    });

    ws.on('close', () => {
        peers.delete(peerId);
    });
});

console.log('Signaling server running on ws://127.0.0.1:8081');