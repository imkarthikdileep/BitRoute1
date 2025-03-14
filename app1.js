let peerConnection;
let dataChannel;
let fileReader;
let receivedBuffers = [];
let fileSize = 0;
let receivedSize = 0;
let metadata = null;
let isInitiator = false;
let file;
let localPeerId;
let remotePeerId;

const status = document.getElementById('status');
const progress = document.getElementById('progress');
const signalBox = document.getElementById('signalBox');
const downloadLink = document.getElementById('downloadLink');

const CHUNK_SIZE = 65536;

function initSignaling() {
    localPeerId = Math.random().toString(36).substring(2, 8);
    signalBox.value = localPeerId;
    status.textContent = `Your Peer ID: ${localPeerId}. Share this ID with your peer.`;
    pollMessages(); // Start polling for messages
}

async function sendSignal(to, message) {
    await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: localPeerId, to, message })
    });
}

async function pollMessages() {
    const response = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: localPeerId })
    });
    const data = await response.json();
    data.messages.forEach(msg => {
        remotePeerId = msg.from;
        handleSignal(msg.message);
    });
    setTimeout(pollMessages, 1000); // Poll every second
}

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

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(remotePeerId, { candidate: event.candidate });
        }
    };

    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            sendSignal(remotePeerId, { sdp: peerConnection.localDescription });
        })
        .catch(err => {
            console.error('Error creating offer:', err);
            status.textContent = `Error creating offer: ${err}`;
        });
}

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
                sendSignal(remotePeerId, { candidate: event.candidate });
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
                            sendSignal(remotePeerId, { sdp: peerConnection.localDescription });
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

// Rest of the code (setupDataChannel, sendFile, receiveChunk) remains the same
// ...

window.startConnection = startConnection;
window.connectPeer = startConnection;
window.onload = initSignaling;