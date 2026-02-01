const app = {
    config: {
        general: { enabled: false, log_level: "info" },
        clients: [],
        servers: []
    },
    currentTab: 'config',
    logEventSource: null,

    init: async () => {
        await app.loadConfig();
        app.updateStatus();
        setInterval(app.updateStatus, 5000);

        // Modal Backdrop click to close
        document.getElementById('edit-modal').addEventListener('click', (e) => {
            if (e.target.id === 'edit-modal') app.closeModal();
        });
    },

    loadConfig: async () => {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) throw new Error("Failed to load config");
            app.config = await res.json();
            app.renderAll();
        } catch (e) {
            console.error(e);
            alert("Error loading configuration");
        }
    },

    renderAll: () => {
        // Global Settings
        document.getElementById('global-enable').checked = app.config.general.enabled;
        document.getElementById('global-loglevel').value = app.config.general.log_level;

        // Clients
        const clientContainer = document.getElementById('client-list');
        clientContainer.innerHTML = app.config.clients.map(c => app.renderCard(c, 'client')).join('');

        // Servers
        const serverContainer = document.getElementById('server-list');
        serverContainer.innerHTML = app.config.servers.map(s => app.renderCard(s, 'server')).join('');
    },

    renderCard: (item, type) => {
        const statusClass = item.enabled ? 'text-success' : 'text-secondary';
        const colorClass = type === 'client' ? 'border-l-4 border-l-blue-500' : 'border-l-4 border-l-purple-500';
        // Note: Tailwind border-l-4 logic isn't in our pure CSS, but we can add inline style for visual distinction if we want.
        // Or simplified:
        const icon = type === 'client'
            ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>'
            : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 01-2 2v4a2 2 0 012 2h14a2 2 0 012-2v-4a2 2 0 01-2-2m-2-4h.01M17 16h.01"></path></svg>';

        return `
            <div class="card flex justify-between items-center" style="border-left: 4px solid ${type === 'client' ? '#3B82F6' : '#A855F7'}">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-slate-800 rounded text-secondary">${icon}</div>
                    <div>
                        <div class="text-lg font-semibold flex items-center gap-2">
                            ${item.alias}
                            <span class="text-xs ${statusClass}">● ${item.enabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <div class="text-sm text-secondary text-mono mt-1">
                            ${item.local_port || item.local_addr} <span class="text-muted">→</span> ${item.remote_addr}:${item.remote_port}
                        </div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-secondary btn-sm" onclick="app.editInstance('${type}', '${item.id}')">Edit</button>
                    ${item.enabled
                ? `<button class="btn btn-danger btn-sm" onclick="app.toggleInstance('${type}', '${item.id}', false)">Stop</button>`
                : `<button class="btn btn-success btn-sm" onclick="app.toggleInstance('${type}', '${item.id}', true)">Start</button>`
            }
                </div>
            </div>
        `;
    },

    toggleGlobal: () => {
        app.config.general.enabled = document.getElementById('global-enable').checked;
        app.saveConfig();
    },

    toggleInstance: (type, id, state) => {
        const list = type === 'client' ? app.config.clients : app.config.servers;
        const item = list.find(x => x.id === id);
        if (item) {
            item.enabled = state;
            app.saveConfig();
        }
    },

    saveConfig: async () => {
        // Update general config from UI first if needed (log level)
        app.config.general.log_level = document.getElementById('global-loglevel').value;

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(app.config)
            });
            if (!res.ok) throw new Error("Failed to save");
            app.renderAll();
            // Re-fetch status to update PIDs etc
            setTimeout(app.updateStatus, 1000);
        } catch (e) {
            alert("Error saving config: " + e.message);
        }
    },

    // Modal Logic
    addClient: () => {
        app.openModal('client', null);
    },
    addServer: () => {
        app.openModal('server', null);
    },
    editInstance: (type, id) => {
        app.openModal(type, id);
    },

    openModal: (type, id) => {
        const isEdit = !!id;
        const list = type === 'client' ? app.config.clients : app.config.servers;
        const item = isEdit ? list.find(x => x.id === id) : {
            id: crypto.randomUUID(),
            alias: '', enabled: true,
            local_addr: '127.0.0.1', local_port: '4567', // Default for client
            remote_addr: '1.2.3.4', remote_port: '4567',
            tun_local: '192.168.200.2', tun_peer: '192.168.200.1',
            tun_name: ''
        };

        if (type === 'server' && !isEdit) {
            // Adjust defaults for server
            item.local_port = '4567';
            delete item.local_addr;
        }

        document.getElementById('modal-title').innerText = isEdit ? `Edit ${type === 'client' ? 'Client' : 'Server'}` : `Add Isntance`;
        document.getElementById('edit-id').value = item.id;
        document.getElementById('edit-type').value = type;
        document.getElementById('edit-alias').value = item.alias;
        document.getElementById('edit-enabled').checked = item.enabled;

        document.getElementById('edit-remote').value = `${item.remote_addr}:${item.remote_port}`;
        document.getElementById('edit-tun-local').value = item.tun_local;
        document.getElementById('edit-tun-peer').value = item.tun_peer;
        document.getElementById('edit-tun-name').value = item.tun_name || '';

        // Handle mixed local input
        if (type === 'client') {
            document.getElementById('edit-local').value = `${item.local_addr}:${item.local_port}`;
            document.getElementById('edit-local').placeholder = "127.0.0.1:4567";
        } else {
            document.getElementById('edit-local').value = item.local_port;
            document.getElementById('edit-local').placeholder = "4567 (Port only)";
        }

        document.getElementById('edit-modal').classList.add('active');
    },

    closeModal: () => {
        document.getElementById('edit-modal').classList.remove('active');
    },

    saveInstance: () => {
        const id = document.getElementById('edit-id').value;
        const type = document.getElementById('edit-type').value;
        const list = type === 'client' ? app.config.clients : app.config.servers;

        let item = list.find(x => x.id === id);
        if (!item) {
            item = { id };
            list.push(item);
        }

        item.alias = document.getElementById('edit-alias').value;
        item.enabled = document.getElementById('edit-enabled').checked;
        item.tun_local = document.getElementById('edit-tun-local').value;
        item.tun_peer = document.getElementById('edit-tun-peer').value;
        item.tun_name = document.getElementById('edit-tun-name').value;

        // Parse Remote
        const [rAddr, rPort] = document.getElementById('edit-remote').value.split(':');
        item.remote_addr = rAddr;
        item.remote_port = rPort;

        // Parse Local
        const localVal = document.getElementById('edit-local').value;
        if (type === 'client') {
            const [lAddr, lPort] = localVal.split(':');
            item.local_addr = lAddr;
            item.local_port = lPort;
        } else {
            item.local_port = localVal;
        }

        app.saveConfig();
        app.closeModal();
    },

    deleteInstance: () => {
        if (!confirm("Are you sure?")) return;
        const id = document.getElementById('edit-id').value;
        const type = document.getElementById('edit-type').value;

        if (type === 'client') {
            app.config.clients = app.config.clients.filter(x => x.id !== id);
        } else {
            app.config.servers = app.config.servers.filter(x => x.id !== id);
        }
        app.saveConfig();
        app.closeModal();
    },

    // Tabs
    switchTab: (tab) => {
        document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
        document.getElementById(`view-${tab}`).style.display = 'block';

        // Update Buttons
        document.querySelectorAll('button[id^="tab-"]').forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        });
        const activeBtn = document.getElementById(`tab-${tab}`);
        activeBtn.classList.remove('btn-secondary');
        activeBtn.classList.add('btn-primary');

        if (tab === 'logs') app.startLogStream();
        else app.stopLogStream();

        if (tab === 'topology') topology.render(app.config);
    },

    // Logs
    startLogStream: () => {
        if (app.logEventSource) return;
        const consoleEl = document.getElementById('log-console');
        consoleEl.innerHTML = '<div class="log-line text-muted">Connecting to log stream...</div>';

        app.logEventSource = new EventSource('/api/logs');
        app.logEventSource.onmessage = (e) => {
            if (e.data === ': heartbeat') return;
            const msg = JSON.parse(e.data);
            const div = document.createElement('div');
            div.className = 'log-line';
            const time = new Date(msg.timestamp).toLocaleTimeString();
            div.innerHTML = `<span class="log-time">[${time}]</span> <span class="text-xs text-muted">${msg.process_id}</span> <span class="log-${msg.stream}">${msg.content}</span>`;
            consoleEl.appendChild(div);
            consoleEl.scrollTop = consoleEl.scrollHeight;
        };
    },

    stopLogStream: () => {
        if (app.logEventSource) {
            app.logEventSource.close();
            app.logEventSource = null;
        }
    },

    clearLogs: () => {
        document.getElementById('log-console').innerHTML = '';
    },

    updateStatus: async () => {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            const el = document.getElementById('status-text');
            const dot = document.querySelector('.status-dot');
            el.innerText = data.enabled ? "Service Running" : "Service Stopped";
            dot.className = `status-dot ${data.enabled ? 'running' : 'stopped'}`;

            // Only update live topology if visible
            if (document.getElementById('view-topology').style.display === 'block') {
                // Pass runtime status to topology
                topology.updateStatus(data.processes);
            }
        } catch (e) {
            // ignore
        }
    }
};

// Start
document.addEventListener('DOMContentLoaded', app.init);
