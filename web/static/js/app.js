document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadStatus();
    loadConfig();
    loadIptables();

    setInterval(loadStatus, 2000); // Poll status every 2s

    document.getElementById('save-config-btn').addEventListener('click', saveConfig);
    document.getElementById('restart-btn').addEventListener('click', restartService);
});

// State
let currentConfig = {
    general: { enabled: false, log_level: 'info' },
    clients: [],
    servers: []
};

// Tabs Logic
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.style.display = 'none');

            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-tab`).style.display = 'block';
        });
    });
}

// API Helpers
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const headers = body ? { 'Content-Type': 'application/json' } : {};
        const res = await fetch(endpoint, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return method === 'GET' ? await res.json() : res;
    } catch (err) {
        showToast(err.message, 'danger');
        console.error(err);
        return null; // Handle error gracefully
    }
}

// Status Pane
async function loadStatus() {
    const data = await apiCall('/api/status');
    if (!data) return;

    // Update Global Status
    const statusEl = document.getElementById('service-status');
    const statusTextEl = document.getElementById('status-text');
    const enabled = data.enabled;
    const running = data.system === 'running'; // Simplified

    statusTextEl.textContent = enabled ? (running ? 'Running' : 'Starting...') : 'Stopped';
    statusTextEl.className = enabled ? 'text-success' : 'text-danger';
    statusEl.style.backgroundColor = enabled ? 'var(--success)' : 'var(--danger)';

    // Render Process Table
    const tbody = document.getElementById('process-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.processes && data.processes.length > 0) {
        data.processes.forEach(proc => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600">${proc.alias}</td>
                <td><span class="badge neutral">${proc.type.toUpperCase()}</span></td>
                <td>${proc.pid}</td>
                <td>
                    <span class="badge ${proc.running ? 'success' : 'danger'}">
                        ${proc.running ? 'Running' : 'Stopped'}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4" class="text-secondary" style="text-align:center;">No instances running</td></tr>';
    }
}

// Config Pane
async function loadConfig() {
    const data = await apiCall('/api/config');
    if (!data) return;
    currentConfig = data;
    renderConfigForm();
}

function renderConfigForm() {
    // General Settings
    document.getElementById('global-enabled').checked = currentConfig.general.enabled;
    document.getElementById('log-level').value = currentConfig.general.log_level;

    // Clients
    const clientList = document.getElementById('client-list');
    clientList.innerHTML = '';
    currentConfig.clients.forEach((client, index) => {
        clientList.appendChild(createClientRow(client, index));
    });

    // Servers
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = '';
    currentConfig.servers.forEach((server, index) => {
        serverList.appendChild(createServerRow(server, index));
    });
}

function createClientRow(client, index) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
        <div class="card-header">
            <span class="card-title">${client.alias || 'New Client'}</span>
            <div class="actions">
                <button class="btn btn-danger btn-sm" onclick="removeClient(${index})">Delete</button>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
            <div class="form-group">
                <label>Alias</label>
                <input type="text" value="${client.alias || ''}" onchange="updateClient(${index}, 'alias', this.value)">
            </div>
            <div class="form-group">
                <label>Enabled</label>
                <label class="switch">
                    <input type="checkbox" ${client.enabled ? 'checked' : ''} onchange="updateClient(${index}, 'enabled', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="form-group">
                <label>Local Bind (Addr:Port)</label>
                <div class="flex gap-2">
                    <input type="text" placeholder="127.0.0.1" value="${client.local_addr}" onchange="updateClient(${index}, 'local_addr', this.value)">
                    <input type="number" placeholder="Port" value="${client.local_port}" onchange="updateClient(${index}, 'local_port', this.value)">
                </div>
            </div>
            <div class="form-group">
                <label>Remote Server (Addr:Port)</label>
                <div class="flex gap-2">
                    <input type="text" placeholder="IP/Domain" value="${client.remote_addr}" onchange="updateClient(${index}, 'remote_addr', this.value)">
                    <input type="number" placeholder="Port" value="${client.remote_port}" onchange="updateClient(${index}, 'remote_port', this.value)">
                </div>
            </div>
            <div class="form-group">
                <label>TUN Interface (Local <-> Peer)</label>
                <div class="flex gap-2">
                    <input type="text" placeholder="192.168.200.1" value="${client.tun_local}" onchange="updateClient(${index}, 'tun_local', this.value)">
                    <input type="text" placeholder="192.168.200.2" value="${client.tun_peer}" onchange="updateClient(${index}, 'tun_peer', this.value)">
                </div>
            </div>
        </div>
    `;
    return div;
}

// Helper to update state
window.updateClient = (index, field, value) => {
    currentConfig.clients[index][field] = value;
};
window.removeClient = (index) => {
    currentConfig.clients.splice(index, 1);
    renderConfigForm();
};
window.addClient = () => {
    currentConfig.clients.push({
        id: crypto.randomUUID(),
        alias: 'Client ' + (currentConfig.clients.length + 1),
        enabled: true,
        local_addr: '127.0.0.1',
        local_port: '51820',
        remote_addr: '',
        remote_port: '4567',
        tun_local: '192.168.200.1',
        tun_peer: '192.168.200.2'
    });
    renderConfigForm();
};

// Server Logic (Similar to Client - Simplified for brevity in this artifact, but I will include minimal support)
function createServerRow(server, index) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
        <div class="card-header">
             <span class="card-title">${server.alias || 'New Server'} (Server Mode)</span>
             <button class="btn btn-danger btn-sm" onclick="removeServer(${index})">Delete</button>
        </div>
        <div class="grid grid-cols-2 gap-4">
             <div class="form-group">
                <label>Local Port</label>
                <input type="number" value="${server.local_port}" onchange="updateServer(${index}, 'local_port', this.value)">
            </div>
             <div class="form-group">
                <label>Forward Target (Remote Addr:Port)</label>
                 <div class="flex gap-2">
                    <input type="text" value="${server.remote_addr}" onchange="updateServer(${index}, 'remote_addr', this.value)">
                    <input type="number" value="${server.remote_port}" onchange="updateServer(${index}, 'remote_port', this.value)">
                </div>
            </div>
        </div>
    `;
    return div;
}
window.updateServer = (index, field, value) => { currentConfig.servers[index][field] = value; };
window.removeServer = (index) => { currentConfig.servers.splice(index, 1); renderConfigForm(); };
window.addServer = () => {
    currentConfig.servers.push({
        id: crypto.randomUUID(),
        alias: 'Server ' + (currentConfig.servers.length + 1),
        enabled: true,
        local_port: '4567',
        remote_addr: '127.0.0.1',
        remote_port: '51820',
        tun_local: '192.168.201.1',
        tun_peer: '192.168.201.2'
    });
    renderConfigForm();
};

async function saveConfig() {
    // Update global settings
    currentConfig.general.enabled = document.getElementById('global-enabled').checked;
    currentConfig.general.log_level = document.getElementById('log-level').value;

    const res = await apiCall('/api/config', 'POST', currentConfig);
    if (res && res.status === 200) { // fetch response object is returned for POST/PUT
        showToast('Configuration saved successfully!', 'success');
        loadStatus();
    } else if (res) { // error handled in apiCall returns null, but here if response exists
        showToast('Configuration saved.', 'success');
    }
}

async function restartService() {
    await apiCall('/api/action/restart', 'POST');
    showToast('Service restarted.', 'info');
    loadStatus();
}

async function loadIptables() {
    fetch('/api/iptables')
        .then(res => res.text())
        .then(text => {
            document.getElementById('iptables-output').textContent = text || 'No iptables output.';
        })
        .catch(err => console.error(err));
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
