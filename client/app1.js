// WebRTC objects
let peerConnection;
let dataChannel;
let fileReader;
let receivedBuffers = [];
let fileSize = 0;
let receivedSize = 0;
let metadata = null;
let isInitiator = false;
let file;
let ws;
let localPeerId;
let remotePeerId;
let useWebSocket = true; // Default to WebSocket
let transferInProgress = false;

// UI elements
const status = document.getElementById('status');
const progress = document.getElementById('progress');
const signalBox = document.getElementById('signalBox');
const downloadLink = document.getElementById('downloadLink');
const fileDropArea = document.getElementById('fileDropArea');
const fileInput = document.getElementById('fileInput');
const connectButton = document.getElementById('connectButton');
const cancelButton = document.getElementById('cancelButton');

const CHUNK_SIZE = 65536;

// Initialize signaling
function initSignaling() {
    if (useWebSocket) {
        ws = new WebSocket('https://bitroute1.onrender.com'); // Replace with Render URL
        ws.onopen = () => {
            status.textContent = 'Connected to WebSocket server. Waiting for peer ID...';
        };
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'id') {
                localPeerId = data.peerId;
                signalBox.value = localPeerId;
                status.textContent = `Your Peer ID (WebSocket): ${localPeerId}. Share with your peer.`;
            } else if (data.from) {
                remotePeerId = data.from;
                handleSignal(data);
            }
        };
        ws.onerror = (err) => {
            status.textContent = 'WebSocket error. Switching to LAN mode.';
            useWebSocket = false;
            initPeerDiscovery();
        };
    } else {
        initPeerDiscovery();
    }
    updateToggleUI();
}

// Peer Discovery via ICE candidates
function initPeerDiscovery() {
    localPeerId = Math.random().toString(36).substring(2, 8);
    signalBox.value = localPeerId;
    status.textContent = `Your Peer ID (LAN): ${localPeerId}. Ensure both devices are on the same network.`;

    peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Broadcasting peer ID:', JSON.stringify({ peerId: localPeerId, candidate: event.candidate }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected' && !isInitiator) {
            status.textContent = 'Connected via LAN!';
            enableFileInput();
        }
    };

    peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
        maxRetransmits: 30
    }).onopen = () => {
        setupDataChannel();
    };
}

// Toggle between WebSocket and LAN
function toggleMode(mode) {
    useWebSocket = mode === 'websocket';
    if (useWebSocket && !ws) {
        initSignaling();
    } else if (!useWebSocket) {
        initPeerDiscovery();
    }
    updateToggleUI();
}

function updateToggleUI() {
    document.querySelectorAll('.toggle-option').forEach(option => {
        option.classList.toggle('active', (option.textContent.toLowerCase() === (useWebSocket ? 'websocket' : 'lan')));
    });
    status.textContent = `Switched to ${useWebSocket ? 'WebSocket' : 'LAN'} mode.`;
}

// Start WebRTC connection
function startConnection() {
    if (!remotePeerId) {
        remotePeerId = signalBox.value.trim();
        if (!remotePeerId) {
            status.textContent = 'Please enter the peer ID to connect.';
            return;
        }
    }

    isInitiator = true;
    if (peerConnection) {
        peerConnection.close();
    }

    peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    dataChannel = peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
        maxRetransmits: 30
    });

    setupDataChannel();

    if (useWebSocket) {
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ to: remotePeerId, candidate: event.candidate }));
            }
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                ws.send(JSON.stringify({ to: remotePeerId, sdp: peerConnection.localDescription }));
            })
            .catch(err => {
                console.error('Error creating offer:', err);
                status.textContent = `Error creating offer: ${err}`;
            });
    } else {
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && remotePeerId === localPeerId) {
                console.log('Self-connection detected, skipping.');
                return;
            }
            if (event.candidate) {
                console.log(`Peer ${localPeerId} broadcasting candidate to ${remotePeerId}`);
            }
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                console.log('Offer created for LAN discovery');
            })
            .catch(err => {
                console.error('Error creating offer:', err);
                status.textContent = `Error creating offer: ${err}`;
            });
    }
}

// Handle incoming signaling messages
function handleSignal(data) {
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel();
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                if (useWebSocket) {
                    ws.send(JSON.stringify({ to: remotePeerId, candidate: event.candidate }));
                } else {
                    console.log(`Peer ${localPeerId} broadcasting candidate`);
                }
            }
        };
    }

    if (data.sdp) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
            .then(() => {
                if (data.sdp.type === 'offer' && !isInitiator) {
                    peerConnection.createAnswer()
                        .then(answer => peerConnection.setLocalDescription(answer))
                        .then(() => {
                            if (useWebSocket) {
                                ws.send(JSON.stringify({ to: remotePeerId, sdp: peerConnection.localDescription }));
                            }
                        })
                        .catch(err => {
                            console.error('Error creating answer:', err);
                            status.textContent = `Error creating answer: ${err}`;
                        });
                }
            })
            .catch(err => {
                console.error('Error setting remote description:', err);
                status.textContent = `Error setting remote description: ${err}`;
            });
    } else if (data.candidate) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
            .catch(err => {
                console.error('Error adding ICE candidate:', err);
                status.textContent = `Error adding ICE candidate: ${err}`;
            });
    }
}

// Setup data channel for file transfer
function setupDataChannel() {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
        console.log("Data channel opened successfully!");
        status.textContent = 'Connected! Drag a file to send or wait to receive.';
        enableFileInput();
    };

    dataChannel.onmessage = receiveChunk;

    dataChannel.onclose = () => {
        console.log("Data channel closed");
        status.textContent = 'Connection closed.';
        disableFileInput();
    };

    dataChannel.onerror = (err) => {
        console.error(`Data channel error: ${err}`);
        status.textContent = `Data channel error: ${err}`;
        disableFileInput();
    };
}

// Enable file input and drag-and-drop
function enableFileInput() {
    fileDropArea.style.display = 'block';
    cancelButton.style.display = 'none';
    transferInProgress = false;
}

function disableFileInput() {
    fileDropArea.style.display = 'none';
    cancelButton.style.display = 'none';
    transferInProgress = false;
    progress.value = 0;
    downloadLink.style.display = 'none';
}

// Drag and Drop Handling
fileDropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropArea.classList.add('dragover');
});

fileDropArea.addEventListener('dragleave', () => {
    fileDropArea.classList.remove('dragover');
});

fileDropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropArea.classList.remove('dragover');
    if (dataChannel && dataChannel.readyState === 'open' && !transferInProgress) {
        file = e.dataTransfer.files[0];
        sendFile({ target: { files: [file] } });
    }
});

fileDropArea.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (dataChannel && dataChannel.readyState === 'open' && !transferInProgress) {
        file = e.target.files[0];
        sendFile(e);
    }
});

// Send file in chunks
function sendFile(event) {
    if (!file || transferInProgress) return;
    transferInProgress = true;
    cancelButton.style.display = 'block';
    status.textContent = `Sending ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`;
    fileSize = file.size;
    progress.max = fileSize;
    progress.value = 0;

    dataChannel.send(JSON.stringify({ name: file.name, size: file.size }));

    fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
        if (!transferInProgress) return;
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        progress.value = offset;
        const sendProgress = Math.floor((offset / fileSize) * 100);
        if (sendProgress % 10 === 0) {
            status.textContent = `Sending ${file.name}: ${sendProgress}%`;
        }

        if (offset < fileSize) {
            if (dataChannel.bufferedAmount > 1024 * 1024) {
                setTimeout(() => readSlice(offset), 100);
            } else {
                readSlice(offset);
            }
        } else {
            status.textContent = `File sent successfully: ${file.name}!`;
            transferInProgress = false;
            cancelButton.style.display = 'none';
        }
    };

    const readSlice = (offset) => {
        if (!transferInProgress) return;
        const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, fileSize));
        fileReader.readAsArrayBuffer(slice);
    };

    readSlice(0);
}

// Cancel file transfer
function cancelTransfer() {
    if (transferInProgress) {
        transferInProgress = false;
        if (fileReader) fileReader.abort();
        if (dataChannel) dataChannel.close();
        status.textContent = 'Transfer canceled.';
        progress.value = 0;
        cancelButton.style.display = 'none';
        enableFileInput();
    }
}

// Receive file chunks
function receiveChunk(event) {
    try {
        if (typeof event.data === 'string') {
            metadata = JSON.parse(event.data);
            fileSize = metadata.size;
            status.textContent = `Receiving ${metadata.name} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)...`;
            progress.max = fileSize;
            receivedBuffers = [];
            receivedSize = 0;
            transferInProgress = true;
            cancelButton.style.display = 'block';
            return;
        }

        receivedBuffers.push(event.data);
        receivedSize += event.data.byteLength;
        progress.value = receivedSize;

        const receivedPercent = Math.floor((receivedSize / fileSize) * 100);
        if (receivedPercent % 10 === 0 && receivedPercent > 0) {
            status.textContent = `Receiving ${metadata.name}: ${receivedPercent}%`;
        }

        if (receivedSize === fileSize && metadata) {
            const blob = new Blob(receivedBuffers);
            const url = URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadLink.download = metadata.name;
            downloadLink.style.display = 'inline';
            status.textContent = 'File received successfully!';
            transferInProgress = false;
            cancelButton.style.display = 'none';
            receivedBuffers = [];
            receivedSize = 0;
        }
    } catch (error) {
        console.error("Error processing received data:", error);
        status.textContent = `Error processing data: ${error.message}`;
        transferInProgress = false;
        cancelButton.style.display = 'none';
    }
}

// Initialize on load
window.onload = () => {
    initSignaling();
    fileDropArea.style.display = 'block';
};

window.startConnection = startConnection;
window.toggleMode = toggleMode;
window.cancelTransfer = cancelTransfer;