// Phantun Manager Application
const app = {
    currentMode: null, // 'server' or 'client'
    editingIndex: null,
    logStream: null,
    logStreaming: false,

    init() {
        this.setupTabs();
        this.loadConfig();
        this.loadStatus();
        this.checkDiagnostics();
        // Auto-refresh status every 5s
        setInterval(() => this.loadStatus(), 5000);
    },

    setupTabs() {
        document.querySelectorAll('.page-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.page-content').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(e.target.dataset.target).classList.add('active');
            });
        });
    },

    async loadConfig() {
        try {
            const resp = await fetch('/api/config');
            const config = await resp.json();
            this.renderServers(config.servers || []);
            this.renderClients(config.clients || []);
            document.getElementById('enableService').checked = config.general?.enabled !== false;
            document.getElementById('logLevel').value = config.general?.log_level || 'info';
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    },

    async loadStatus() {
        try {
            const resp = await fetch('/api/status');
            const status = await resp.json();
            this.updateServiceStatus(status);
            this.updateTunnelStatus(status.processes || []);
        } catch (err) {
            console.error('Failed to load status:', err);
        }
    },

    updateServiceStatus(status) {
        const badge = document.getElementById('serviceStatus');
        const count = document.getElementById('tunnelCount');
        const running = (status.processes || []).filter(p => p.running).length;
        const total = (status.processes || []).length;

        if (running > 0) {
            badge.textContent = 'Running';
            badge.className = 'status-badge running';
        } else {
            badge.textContent = 'Stopped';
            badge.className = 'status-badge stopped';
        }
        count.textContent = `(${running}/${total} tunnels active)`;
    },

    updateTunnelStatus(processes) {
        const tbody = document.getElementById('tunnelStatusBody');
        if (processes.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No tunnels configured.</td></tr>';
            return;
        }
        tbody.innerHTML = processes.map(p => `
            <tr>
                <td>${this.escapeHtml(p.alias || p.id)}</td>
                <td>${p.type === 'client' ? 'Client' : 'Server'}</td>
                <td><span class="status-badge ${p.running ? 'running' : 'stopped'}">${p.running ? 'Running' : 'Stopped'}</span></td>
                <td>${this.escapeHtml(p.local || '-')}</td>
                <td>${this.escapeHtml(p.remote || '-')}</td>
                <td>${this.escapeHtml(p.tun_local || '-')} ↔ ${this.escapeHtml(p.tun_peer || '-')}</td>
                <td>${p.pid || '-'}</td>
            </tr>
        `).join('');
    },

    async checkDiagnostics() {
        const diagBinary = document.getElementById('diagBinary');
        const diagIptables = document.getElementById('diagIptables');

        try {
            const resp = await fetch('/api/status');
            const data = await resp.json();

            // Core Binary Status
            diagBinary.innerHTML = data.binary_ok ?
                '<span class="status-icon">✓</span><span>Phantun binaries found</span>' :
                '<span class="status-icon">✗</span><span>Phantun binaries missing</span>';

            // Iptables Status
            const iptablesResp = await fetch('/api/iptables');
            const iptables = await iptablesResp.json();
            const count = (iptables.rules || []).length;
            diagIptables.innerHTML = count > 0 ?
                `<span class="status-icon">✓</span><span>${count} rules active</span>` :
                '<span class="status-icon">⚠</span><span>No rules configured</span>';
        } catch (err) {
            console.error('Diagnostics check failed:', err);
        }
    },

    renderServers(servers) {
        const tbody = document.getElementById('serverTableBody');
        if (servers.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No server instances.</td></tr>';
            return;
        }
        tbody.innerHTML = servers.map((srv, idx) => `
            <tr>
                <td>${this.escapeHtml(srv.alias || `Server ${idx + 1}`)}</td>
                <td><input type="checkbox" ${srv.enabled ? 'checked' : ''} disabled></td>
                <td>${srv.server_port || '-'}</td>
                <td>${this.escapeHtml(srv.forward_ip || '-')}</td>
                <td>${srv.forward_port || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="app.openEditModal('server', ${idx})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteInstanceDirect('server', ${idx})">Delete</button>
                </td>
            </tr>
        `).join('');
    },

    renderClients(clients) {
        const tbody = document.getElementById('clientTableBody');
        if (clients.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No client instances.</td></tr>';
            return;
        }
        tbody.innerHTML = clients.map((cli, idx) => `
            <tr>
                <td>${this.escapeHtml(cli.alias || `Client ${idx + 1}`)}</td>
                <td><input type="checkbox" ${cli.enabled ? 'checked' : ''} disabled></td>
                <td>${this.escapeHtml(cli.remote_addr || '-')}</td>
                <td>${cli.remote_port || '-'}</td>
                <td>${cli.local_port || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="app.openEditModal('client', ${idx})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteInstanceDirect('client', ${idx})">Delete</button>
                </td>
            </tr>
        `).join('');
    },

    openAddModal(mode) {
        this.currentMode = mode;
        this.editingIndex = null;
        document.getElementById('editModalTitle').textContent = mode === 'server' ? 'Add Server Instance' : 'Add Client Instance';
        this.clearModalFields();
        this.showModalFields(mode);
        document.getElementById('deleteBtn').style.display = 'none';
        document.getElementById('editModal').classList.add('active');
    },

    openEditModal(mode, index) {
        this.currentMode = mode;
        this.editingIndex = index;
        document.getElementById('editModalTitle').textContent = mode === 'server' ? 'Edit Server Instance' : 'Edit Client Instance';
        this.loadModalData(mode, index);
        this.showModalFields(mode);
        document.getElementById('deleteBtn').style.display = 'inline-block';
        document.getElementById('editModal').classList.add('active');
    },

    async loadModalData(mode, index) {
        const resp = await fetch('/api/config');
        const config = await resp.json();
        const data = mode === 'server' ? config.servers[index] : config.clients[index];

        document.getElementById('editEnable').checked = data.enabled !== false;
        document.getElementById('editAlias').value = data.alias || '';
        document.getElementById('editTunLocal').value = data.tun_local || '';
        document.getElementById('editTunPeer').value = data.tun_peer || '';

        if (mode === 'server') {
            document.getElementById('editServerPort').value = data.server_port || '';
            document.getElementById('editForwardIp').value = data.forward_ip || '';
            document.getElementById('editForwardPort').value = data.forward_port || '';
        } else {
            document.getElementById('editRemoteAddr').value = data.remote_addr || '';
            document.getElementById('editRemotePort').value = data.remote_port || '';
            document.getElementById('editLocalPort').value = data.local_port || '';
        }
    },

    showModalFields(mode) {
        const serverFields = document.querySelectorAll('.server-field');
        const clientFields = document.querySelectorAll('.client-field');

        if (mode === 'server') {
            serverFields.forEach(f => f.style.display = '');
            clientFields.forEach(f => f.style.display = 'none');
        } else {
            serverFields.forEach(f => f.style.display = 'none');
            clientFields.forEach(f => f.style.display = '');
        }
    },

    clearModalFields() {
        document.getElementById('editEnable').checked = true;
        document.getElementById('editAlias').value = '';
        document.getElementById('editServerPort').value = '';
        document.getElementById('editForwardIp').value = '';
        document.getElementById('editForwardPort').value = '';
        document.getElementById('editRemoteAddr').value = '';
        document.getElementById('editRemotePort').value = '';
        document.getElementById('editLocalPort').value = '';
        document.getElementById('editTunLocal').value = '';
        document.getElementById('editTunPeer').value = '';
    },

    async saveInstance() {
        const resp = await fetch('/api/config');
        const config = await resp.json();

        const instance = {
            enabled: document.getElementById('editEnable').checked,
            alias: document.getElementById('editAlias').value,
            tun_local: document.getElementById('editTunLocal').value,
            tun_peer: document.getElementById('editTunPeer').value
        };

        if (this.currentMode === 'server') {
            instance.server_port = parseInt(document.getElementById('editServerPort').value);
            instance.forward_ip = document.getElementById('editForwardIp').value;
            instance.forward_port = parseInt(document.getElementById('editForwardPort').value);

            if (this.editingIndex !== null) {
                config.servers[this.editingIndex] = instance;
            } else {
                config.servers = config.servers || [];
                config.servers.push(instance);
            }
        } else {
            instance.remote_addr = document.getElementById('editRemoteAddr').value;
            instance.remote_port = parseInt(document.getElementById('editRemotePort').value);
            instance.local_port = parseInt(document.getElementById('editLocalPort').value);

            if (this.editingIndex !== null) {
                config.clients[this.editingIndex] = instance;
            } else {
                config.clients = config.clients || [];
                config.clients.push(instance);
            }
        }

        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        this.closeModal('editModal');
        this.loadConfig();
    },

    async deleteInstance() {
        if (!confirm('Are you sure you want to delete this instance?')) return;
        await this.deleteInstanceDirect(this.currentMode, this.editingIndex);
        this.closeModal('editModal');
    },

    async deleteInstanceDirect(mode, index) {
        if (!confirm('Delete this instance?')) return;
        const resp = await fetch('/api/config');
        const config = await resp.json();

        if (mode === 'server') {
            config.servers.splice(index, 1);
        } else {
            config.clients.splice(index, 1);
        }

        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        this.loadConfig();
    },

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },

    async saveAndApply() {
        await this.saveConfig();
        await fetch('/api/action/restart', { method: 'POST' });
        alert('Configuration saved and applied! Services restarting...');
        setTimeout(() => this.loadStatus(), 2000);
    },

    async saveOnly() {
        await this.saveConfig();
        alert('Configuration saved.');
    },

    async saveConfig() {
        const resp = await fetch('/api/config');
        const config = await resp.json();

        config.general = {
            enabled: document.getElementById('enableService').checked,
            log_level: document.getElementById('logLevel').value
        };

        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    },

    async resetConfigWithConfirm() {
        if (!confirm('Reset to default configuration? This will delete all instances!')) return;
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ general: {}, servers: [], clients: [] })
        });
        this.loadConfig();
    },

    // Import/Export
    importConfig(mode) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            const text = await file.text();
            const instances = JSON.parse(text);

            const resp = await fetch('/api/config');
            const config = await resp.json();

            if (mode === 'server') {
                config.servers = instances;
            } else {
                config.clients = instances;
            }

            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            this.loadConfig();
            alert(`Imported ${instances.length} ${mode} instance(s).`);
        };
        input.click();
    },

    async exportConfig(mode) {
        const resp = await fetch('/api/config');
        const config = await resp.json();
        const data = mode === 'server' ? config.servers : config.clients;

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phantun-${mode}s-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Logs
    toggleLogStream() {
        if (this.logStreaming) {
            this.stopLogStream();
        } else {
            this.startLogStream();
        }
    },

    startLogStream() {
        this.logStream = new EventSource('/api/logs');
        this.logStreaming = true;
        document.getElementById('logStreamBtn').textContent = 'Stop Refresh';

        this.logStream.onmessage = (event) => {
            try {
                const log = JSON.parse(event.data);
                this.appendLog(log);
            } catch (err) {
                console.error('Failed to parse log:', err);
            }
        };

        this.logStream.onerror = () => {
            console.error('Log stream error');
            this.stopLogStream();
        };
    },

    stopLogStream() {
        if (this.logStream) {
            this.logStream.close();
            this.logStream = null;
        }
        this.logStreaming = false;
        document.getElementById('logStreamBtn').textContent = 'Start Refresh';
    },

    appendLog(log) {
        const container = document.getElementById('logContent');
        const line = document.createElement('span');
        line.className = 'log-line';
        line.textContent = `[${log.timestamp || new Date().toISOString()}] [${log.source || 'system'}] ${log.message}`;
        container.appendChild(line);

        // Update timestamp
        const now = new Date();
        document.getElementById('logTimestamp').textContent = now.toLocaleTimeString();

        // Auto-scroll
        if (container.parentElement.scrollTop + container.parentElement.clientHeight >= container.parentElement.scrollHeight - 50) {
            this.scrollLogsToBottom();
        }
    },

    clearLogs() {
        document.getElementById('logContent').innerHTML = '<span class="log-line">Logs cleared.</span>';
    },

    scrollLogsToBottom() {
        const container = document.getElementById('logContent').parentElement;
        container.scrollTop = container.scrollHeight;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => app.init());
