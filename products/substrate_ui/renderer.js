
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

// PATCH 6: Call State (Mock)
window.toggleCallState = function (el) {
    el.classList.toggle('active');
    const statusEl = el.parentElement.querySelector('.call-status');
    if (el.classList.contains('active')) {
        statusEl.innerText = "Listening...";
        statusEl.style.color = "var(--accent)";
    } else {
        statusEl.innerText = "Idle";
        statusEl.style.color = "var(--muted)";
    }
}


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
