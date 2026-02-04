
// TELE PORTAL LOGIC V2 + WEBSOCKET CLIENT

// Helper for selecting elements
const $ = (selector) => document.querySelector(selector);

// WebSocket Client for Real-Time State
(function initWebSocket() {
    const ws = new WebSocket('ws://127.0.0.1:3000');

    const statusBox = $('#shelf-agent .shelf-body');

    ws.onopen = () => {
        console.log('[UI] Connected to Runtime');
        if (statusBox) statusBox.style.opacity = '1';

        // Handshake
        ws.send(JSON.stringify({
            type: 'HELLO',
            lastEventId: null
        }));

        // Chat Listener
        const agentInput = document.getElementById('agent-input');
        if (agentInput) {
            agentInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const text = agentInput.value.trim();
                    if (text && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'USER_INPUT',
                            payload: { text }
                        }));
                        agentInput.value = '';
                    }
                }
            };
        }


    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleRuntimeMessage(msg);
        } catch (e) {
            console.error('[UI] WS Error', e);
        }
    };

    ws.onclose = () => {
        console.log('[UI] Disconnected');
        if (statusBox) statusBox.style.opacity = '0.5';
        setTimeout(initWebSocket, 2000); // Retry
    };

    function handleRuntimeMessage(msg) {
        if (msg.type === 'SNAPSHOT') {
            // Hydrate initial state
            // msg.payload.events -> populate timeline
            // msg.payload.artifacts -> populate dropspace
            console.log('[UI] Snapshot received', msg.payload);
            msg.payload.events.forEach(addTimelineEvent);
        } else if (msg.type === 'BUS_EVENT') {
            const { type, data } = msg.payload;

            if (type === 'TIMELINE_EVENT') {
                addTimelineEvent(data);
            } else if (type === 'OBJECT_UPDATE') {
                // Flash agent update maybe?
                updateAgentThinking(data);
            }
        }
    }

    function addTimelineEvent(evt) {
        const shelf = $('#shelf-timeline .shelf-body');
        if (!shelf) return;

        const row = document.createElement('div');
        row.className = 'timeline-row';
        const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        row.innerText = `${time} - ${evt.description}`;

        // Prepend
        shelf.insertBefore(row, shelf.firstChild);
    }

    function updateAgentThinking(data) {
        // e.g. Action updates
        const agentBox = document.querySelector('#shelf-agent .shelf-body div'); // messy selector but works for now
        if (agentBox && data.type === 'ACTION') {
            // Update the "Latest thought" box
            const thoughtBox = agentBox.querySelector('div');
            if (thoughtBox) thoughtBox.innerText = `Latest action: ${data.object.type} (${data.object.status})`;
        }
    }
})();


// Shelf Toggle Logic
window.toggleShelf = function (id) {
    const shelf = document.getElementById(id);
    if (!shelf) return;
    shelf.classList.toggle('is-collapsed');
}

// DropSpace Fullscreen Logic
window.toggleDropSpaceFS = function () {
    const el = document.getElementById('ds-fullscreen');
    if (!el) return;
    el.classList.toggle('is-open');
}

// PATCH 5: Maximize Workspace
const btnMax = document.getElementById('btn-maximize');
if (btnMax) {
    btnMax.addEventListener('click', () => {
        document.body.classList.toggle('workspace-max');
    });
}

// PATCH 6: Call State - Real Voice Integration
(function initVoiceButton() {
    const voiceBtn = document.getElementById('voice-btn');
    const voiceStatus = document.getElementById('voice-status');
    const micIcon = document.getElementById('mic-icon');
    const stopIcon = document.getElementById('stop-icon');

    if (!voiceBtn) {
        console.log('[Voice] Button not found, skipping init');
        return;
    }

    let isListening = false;

    voiceBtn.addEventListener('click', async () => {
        console.log('[Voice] Button clicked, isListening:', isListening);

        if (!isListening) {
            // Start listening
            voiceStatus.innerText = "Avvio...";
            voiceStatus.style.color = "var(--accent)";
            voiceBtn.classList.add('active');

            try {
                const res = await fetch('http://127.0.0.1:3000/voice/start-loop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (res.ok) {
                    isListening = true;
                    voiceStatus.innerText = "🎙️ In ascolto...";
                    if (micIcon) micIcon.style.display = 'none';
                    if (stopIcon) stopIcon.style.display = 'block';
                    console.log('[Voice] Started successfully');
                } else {
                    throw new Error('Backend error');
                }
            } catch (err) {
                console.error('[Voice] Start failed:', err);
                voiceStatus.innerText = "Errore connessione";
                voiceStatus.style.color = "#f87171";
                voiceBtn.classList.remove('active');
            }
        } else {
            // Stop listening
            voiceStatus.innerText = "Fermo...";

            try {
                await fetch('http://127.0.0.1:3000/voice/stop-loop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                console.error('[Voice] Stop error:', err);
            }

            isListening = false;
            voiceBtn.classList.remove('active');
            voiceStatus.innerText = "Premi per parlare";
            voiceStatus.style.color = "var(--muted)";
            if (micIcon) micIcon.style.display = 'block';
            if (stopIcon) stopIcon.style.display = 'none';
            console.log('[Voice] Stopped');
        }
    });

    console.log('[Voice] Button initialized');
})();


// PATCH C: Splitter Logic Fix (Pointer Events)
(function initSplitter() {
    const splitter = document.getElementById('left-splitter');
    const shelfTop = document.getElementById('shelf-agent');
    const shelfBottom = document.getElementById('shelf-dropspace');
    const container = document.querySelector('.tele-left');

    if (!splitter || !shelfTop || !shelfBottom) return;

    splitter.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // Prevent text selection etc
        splitter.setPointerCapture(e.pointerId);

        const startY = e.clientY;
        const startHeight = shelfTop.getBoundingClientRect().height;

        const onPointerMove = (moveEvent) => {
            const dy = moveEvent.clientY - startY;
            let newHeight = startHeight + dy;

            // Constraints
            if (newHeight < 90) newHeight = 90;
            // 65% of container height max
            if (newHeight > container.getBoundingClientRect().height * 0.65) {
                newHeight = container.getBoundingClientRect().height * 0.65;
            }

            shelfTop.style.flex = `0 0 ${newHeight}px`;
            // Bottom shelf is flex: 1, so it auto-adjusts
        };

        const onPointerUp = (upEvent) => {
            splitter.releasePointerCapture(upEvent.pointerId);
            splitter.removeEventListener('pointermove', onPointerMove);
            splitter.removeEventListener('pointerup', onPointerUp);
            // Save state if needed
        };

        splitter.addEventListener('pointermove', onPointerMove);
        splitter.addEventListener('pointerup', onPointerUp);
    });
})();


// PATCH E: Workspace Panning (Background Drag)
(function initWorkspacePan() {
    const workspace = document.getElementById('workspace');
    const camera = document.getElementById('ws-camera');

    if (!workspace || !camera) return;

    let camX = 0;
    let camY = 0;
    let isPanning = false;

    workspace.addEventListener('mousedown', (e) => {
        // If clicking on a node or note, don't pan
        if (e.target.closest('.ws-node') || e.target.closest('.ws-note')) return;

        isPanning = true;
        workspace.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;

        camX += e.movementX;
        camY += e.movementY;

        camera.style.transform = `translate(${camX}px, ${camY}px)`;
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            workspace.style.cursor = '';
        }
    });

    // Optional: Wheel Zoom?
    workspace.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            // Implement zoom later if needed
        }
    });
})();


// Draggable Nodes Logic (Updated for Camera)
(function initNodeDrag() {
    const camera = document.getElementById('ws-camera');
    if (!camera) return;

    let dragItem = null;

    camera.addEventListener('mousedown', (e) => {
        const node = e.target.closest('.ws-node');
        if (node) {
            e.stopPropagation(); // Don't trigger pan
            dragItem = node;
            node.style.zIndex = 1000;
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragItem) return;

        // Simple delta movement
        const currentLeft = parseInt(dragItem.style.left || 0);
        const currentTop = parseInt(dragItem.style.top || 0);

        // Use movementX/Y for simplest relative dragging irrespective of camera zoom/pan
        dragItem.style.left = `${currentLeft + e.movementX}px`;
        dragItem.style.top = `${currentTop + e.movementY}px`;
    });

    window.addEventListener('mouseup', () => {
        if (dragItem) {
            dragItem.style.zIndex = '';
            dragItem = null;
        }
    });
})();

// PHASE 11: Builder UI Logic
(function initBuilder() {
    const patchesContainer = document.getElementById('builder-patches');
    const stateEl = document.getElementById('builder-state');
    const retryBtn = document.getElementById('builder-retry');

    if (!patchesContainer) return;

    // Track patches
    const patches = [];

    window.addBuilderPatch = function (patch) {
        patches.push(patch);
        renderPatches();
    };

    window.updateBuilderState = function (state) {
        if (stateEl) {
            stateEl.innerText = state;
            stateEl.style.color = state === 'Working' ? 'var(--accent)' : 'var(--muted)';
        }
    };

    function renderPatches() {
        patchesContainer.innerHTML = patches.slice(-5).map(p => `
            <div style="padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.02); border-radius: 4px; font-size: 11px;">
                <span style="color: ${p.status === 'applied' ? '#4ade80' : p.status === 'failed' ? '#f87171' : 'var(--muted)'};">●</span>
                ${p.title.substring(0, 30)}${p.title.length > 30 ? '...' : ''}
            </div>
        `).join('');
    }

    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            console.log('[Builder] Retry clicked');
            // Could send WS message to trigger retry
        });
    }
})();
