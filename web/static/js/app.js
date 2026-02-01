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
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    },

    cleanup() {
        if (this.logStream) {
            this.logStream.close();
        }
    },

    showError(message, details = '') {
        const errorBox = document.createElement('div');
        errorBox.className = 'error-toast';
        errorBox.innerHTML = `
            <strong>Error:</strong> ${this.escapeHtml(message)}
            ${details ? `<br><small>${this.escapeHtml(details)}</small>` : ''}
        `;
        document.body.appendChild(errorBox);
        setTimeout(() => errorBox.classList.add('show'), 10);
        setTimeout(() => {
            errorBox.classList.remove('show');
            setTimeout(() => errorBox.remove(), 300);
        }, 5000);
    },

    showSuccess(message) {
        const successBox = document.createElement('div');
        successBox.className = 'success-toast';
        successBox.innerHTML = `<strong>Success:</strong> ${this.escapeHtml(message)}`;
        document.body.appendChild(successBox);
        setTimeout(() => successBox.classList.add('show'), 10);
        setTimeout(() => {
            successBox.classList.remove('show');
            setTimeout(() => successBox.remove(), 300);
        }, 3000);
    },

    async fetchWithError(url, options = {}) {
        try {
            const resp = await fetch(url, options);
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
            }
            return resp;
        } catch (err) {
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                throw new Error('Network error - unable to reach server');
            }
            throw err;
        }
    },

    setupTabs() {
        document.querySelectorAll('.page-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Update tabs
                document.querySelectorAll('.page-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });

                // Update panels
                document.querySelectorAll('.page-content').forEach(c => {
                    c.classList.remove('active');
                    c.setAttribute('aria-hidden', 'true');
                });

                // Activate selected
                e.target.classList.add('active');
                e.target.setAttribute('aria-selected', 'true');

                const panel = document.getElementById(e.target.dataset.target);
                panel.classList.add('active');
                panel.setAttribute('aria-hidden', 'false');
            });
        });
    },

    async loadConfig() {
        try {
            const resp = await this.fetchWithError('/api/config');
            const config = await resp.json();
            this.renderServers(config.servers || []);
            this.renderClients(config.clients || []);
            document.getElementById('enableService').checked = config.general?.enabled !== false;
            document.getElementById('logLevel').value = config.general?.log_level || 'info';
        } catch (err) {
            console.error('Failed to load config:', err);
            this.showError('Failed to load configuration', err.message);
        }
    },

    async loadStatus() {
        try {
            const resp = await this.fetchWithError('/api/status');
            const status = await resp.json();
            this.updateServiceStatus(status);
            this.updateTunnelStatus(status.processes || []);
        } catch (err) {
            console.error('Failed to load status:', err);
            // Don't show error for status polling to avoid spam
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
            const resp = await this.fetchWithError('/api/status');
            const data = await resp.json();

            // Core Binary Status
            diagBinary.innerHTML = data.binary_ok ?
                '<span class="status-icon">✓</span><span>Phantun binaries found</span>' :
                '<span class="status-icon">✗</span><span>Phantun binaries missing</span>';

            // Iptables Status
            const iptablesResp = await this.fetchWithError('/api/iptables');
            const iptables = await iptablesResp.json();
            const count = (iptables.rules || []).length;
            diagIptables.innerHTML = count > 0 ?
                `<span class="status-icon">✓</span><span>${count} rules active</span>` :
                '<span class="status-icon">⚠</span><span>No rules configured</span>';
        } catch (err) {
            console.error('Diagnostics check failed:', err);
            this.showError('Failed to run diagnostics', err.message);
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
        try {
            const resp = await this.fetchWithError('/api/config');
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
        } catch (err) {
            console.error('Failed to load instance data:', err);
            this.showError('Failed to load instance data', err.message);
            this.closeModal('editModal');
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
        try {
            const resp = await this.fetchWithError('/api/config');
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

            await this.fetchWithError('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            this.showSuccess('Instance saved successfully');
            this.closeModal('editModal');
            this.loadConfig();
        } catch (err) {
            console.error('Failed to save instance:', err);
            this.showError('Failed to save instance', err.message);
        }
    },

    async deleteInstance() {
        if (!confirm('Are you sure you want to delete this instance?')) return;
        await this.deleteInstanceDirect(this.currentMode, this.editingIndex);
        this.closeModal('editModal');
    },

    async deleteInstanceDirect(mode, index) {
        if (!confirm('Delete this instance?')) return;
        try {
            const resp = await this.fetchWithError('/api/config');
            const config = await resp.json();

            if (mode === 'server') {
                config.servers.splice(index, 1);
            } else {
                config.clients.splice(index, 1);
            }

            await this.fetchWithError('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            this.showSuccess('Instance deleted successfully');
            this.loadConfig();
        } catch (err) {
            console.error('Failed to delete instance:', err);
            this.showError('Failed to delete instance', err.message);
        }
    },

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },

    async saveAndApply() {
        try {
            await this.saveConfig();
            await this.fetchWithError('/api/action/restart', { method: 'POST' });
            this.showSuccess('Configuration saved and applied! Services restarting...');
            setTimeout(() => this.loadStatus(), 2000);
        } catch (err) {
            console.error('Failed to save and apply:', err);
            this.showError('Failed to save and apply', err.message);
        }
    },

    async saveOnly() {
        try {
            await this.saveConfig();
            this.showSuccess('Configuration saved successfully');
        } catch (err) {
            console.error('Failed to save config:', err);
            this.showError('Failed to save configuration', err.message);
        }
    },

    async saveConfig() {
        const resp = await this.fetchWithError('/api/config');
        const config = await resp.json();

        config.general = {
            enabled: document.getElementById('enableService').checked,
            log_level: document.getElementById('logLevel').value
        };

        await this.fetchWithError('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    },

    async resetConfigWithConfirm() {
        if (!confirm('Reset to default configuration? This will delete all instances!')) return;
        try {
            await this.fetchWithError('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ general: {}, servers: [], clients: [] })
            });
            this.showSuccess('Configuration reset to defaults');
            this.loadConfig();
        } catch (err) {
            console.error('Failed to reset config:', err);
            this.showError('Failed to reset configuration', err.message);
        }
    },

    // Import/Export
    importConfig(mode) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            try {
                const file = e.target.files[0];
                const text = await file.text();
                const instances = JSON.parse(text);

                const resp = await this.fetchWithError('/api/config');
                const config = await resp.json();

                if (mode === 'server') {
                    config.servers = instances;
                } else {
                    config.clients = instances;
                }

                await this.fetchWithError('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                this.loadConfig();
                this.showSuccess(`Imported ${instances.length} ${mode} instance(s)`);
            } catch (err) {
                console.error('Failed to import config:', err);
                this.showError('Failed to import configuration', err.message);
            }
        };
        input.click();
    },

    async exportConfig(mode) {
        try {
            const resp = await this.fetchWithError('/api/config');
            const config = await resp.json();
            const data = mode === 'server' ? config.servers : config.clients;

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `phantun-${mode}s-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showSuccess(`Configuration exported successfully`);
        } catch (err) {
            console.error('Failed to export config:', err);
            this.showError('Failed to export configuration', err.message);
        }
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
