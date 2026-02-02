// ===== CONFIGURATION =====
const CONFIG = {
    // Polling & Refresh
    STATUS_POLL_INTERVAL: 5000,        // 5 seconds

    // Logs
    LOG_MAX_LINES: 1000,               // Maximum log lines to keep
    AUTO_SCROLL_THRESHOLD: 50,         // Pixels from bottom to trigger auto-scroll

    // Notifications
    ERROR_TOAST_DURATION: 5000,        // 5 seconds
    SUCCESS_TOAST_DURATION: 3000,      // 3 seconds
    TOAST_ANIMATION_DELAY: 10,         // ms before show animation
    TOAST_HIDE_DELAY: 300,             // ms fade-out duration

    // Service Management
    SERVICE_RESTART_CHECK_DELAY: 2000, // 2 seconds after restart

    // API Endpoints
    API: {
        STATUS: '/api/status',
        CONFIG: '/api/config',
        LOGS: '/api/logs',
        IPTABLES: '/api/iptables',
        ACTION_RESTART: '/api/action/restart'
    }
};

// ===== TRANSLATIONS =====
const TRANSLATIONS = {
    "en": {
        "nav.dashboard": "Dashboard",
        "nav.config": "Configuration",
        "nav.status": "Status",
        "nav.logout": "Logout",
        "header.topology": "Network Topology",
        "header.tunnel_status": "Tunnel Status Summary",
        "table.name": "Name",
        "table.mode": "Mode",
        "table.status": "Status",
        "table.local": "Local",
        "table.remote": "Remote",
        "topo.client": "CLIENT",
        "topo.server": "SERVER",
        "topo.local": "Local",
        "topo.remote": "Remote",
        "status.running": "Running",
        "status.stopped": "Stopped",
        "mode.client": "Client",
        "mode.server": "Server",
        "btn.toggle_lang": "EN"
    },
    "zh": {
        "nav.dashboard": "仪表盘",
        "nav.config": "配置管理",
        "nav.status": "系统状态",
        "nav.logout": "退出登录",
        "header.topology": "网络拓扑",
        "header.tunnel_status": "隧道状态概览",
        "table.name": "名称",
        "table.mode": "模式",
        "table.status": "状态",
        "table.local": "本地地址",
        "table.remote": "远端地址",
        "topo.client": "客户端",
        "topo.server": "服务端",
        "topo.local": "本地",
        "topo.remote": "远端",
        "status.running": "运行中",
        "status.stopped": "已停止",
        "mode.client": "客户端",
        "mode.server": "服务端",
        "btn.toggle_lang": "中"
    }
};

let currentLang = localStorage.getItem('lang') || 'en';

function t(key) {
    return (TRANSLATIONS[currentLang] || TRANSLATIONS['en'])[key] || key;
}

function updateLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);

    // 1. Static Elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    // 2. Button Text
    const btn = document.querySelector('.btn-lang-text');
    if (btn) btn.textContent = lang === 'en' ? 'EN' : '中';

    // 3. Dynamic Refresh (Safety check for app existence)
    // We defer this slightly to ensure app is initialized if called during load
    setTimeout(() => {
        if (typeof app !== 'undefined') {
            if (app.lastConfig) app.renderTopology(app.lastConfig.clients || [], app.lastConfig.servers || []);
            if (app.lastStatus) app.updateTunnelStatus(app.lastStatus.processes || []);
        }
    }, 10);
}

// ===== APPLICATION =====
// Phantun Manager Application
const app = {
    currentMode: null, // 'server' or 'client'
    editingIndex: null,
    logStream: null,
    logStreaming: false,

    init() {
        this.setupTabs(); // Setup tabs with persistence
        updateLanguage(currentLang); // Init I18n
        this.loadConfig();
        this.loadStatus();
        this.updateDiagnostics({}); // Init diagnostics empty
        this.startLogStream();      // Auto-start logs

        // Auto-refresh status every 5s
        setInterval(() => this.loadStatus(), CONFIG.STATUS_POLL_INTERVAL);

        // Initial Theme
        if (typeof this.initTheme === 'function') this.initTheme();

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
        setTimeout(() => errorBox.classList.add('show'), CONFIG.TOAST_ANIMATION_DELAY);
        setTimeout(() => {
            errorBox.classList.remove('show');
            setTimeout(() => errorBox.remove(), CONFIG.TOAST_HIDE_DELAY);
        }, CONFIG.ERROR_TOAST_DURATION);
    },

    showSuccess(message) {
        const successBox = document.createElement('div');
        successBox.className = 'success-toast';
        successBox.innerHTML = `<strong>Success:</strong> ${this.escapeHtml(message)}`;
        document.body.appendChild(successBox);
        setTimeout(() => successBox.classList.add('show'), CONFIG.TOAST_ANIMATION_DELAY);
        setTimeout(() => {
            successBox.classList.remove('show');
            setTimeout(() => successBox.remove(), CONFIG.TOAST_HIDE_DELAY);
        }, CONFIG.SUCCESS_TOAST_DURATION);
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
        // 1. Restore Active Tab
        const savedTabId = localStorage.getItem('activeTab') || 'dashboardPage';

        // Find the button that targets this tab
        // Iterate all tabs to find matching onclick
        const tabs = document.querySelectorAll('.page-tab');
        let targetBtn = tabs[0]; // Default to first

        tabs.forEach(btn => {
            if (btn.getAttribute('onclick').includes(`'${savedTabId}'`)) {
                targetBtn = btn;
            }
            // Add click listener to save state
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
                localStorage.setItem('activeTab', targetId);
            });
        });

        if (targetBtn) {
            const targetId = targetBtn.getAttribute('onclick').match(/'([^']+)'/)[1];
            this.switchTab(targetBtn, targetId);
        }
    },

    switchTab(btn, targetId) {
        // Deactivate all
        document.querySelectorAll('.page-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.page-content').forEach(c => {
            c.classList.remove('active');
            c.style.display = 'none'; // Ensure hidden
            c.setAttribute('aria-hidden', 'true');
        });

        // Activate target
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const target = document.getElementById(targetId);
        if (target) {
            target.style.display = 'block';
            setTimeout(() => target.classList.add('active'), 10); // Fade in
            target.setAttribute('aria-hidden', 'false');

            // Special handling for Dashboard Topology
            // Special handling for Dashboard Topology
            if (targetId === 'dashboardPage') {
                if (this.lastConfig) this.renderTopology(this.lastConfig.clients || [], this.lastConfig.servers || []);
                else this.loadConfig();
            }
        }
    },

    switchModalTab(tabName) {
        // Buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('onclick').includes(`'${tabName}'`)) {
                btn.classList.add('active');
            }
        });

        // Content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            content.style.display = 'none';
        });

        const targetId = 'modalTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
        const target = document.getElementById(targetId);
        if (target) {
            target.classList.add('active');
            target.style.display = 'block';
        }
    },

    async loadConfig() {
        try {
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();
            this.lastConfig = config; // Cache for export
            this.renderServers(config.servers || []);
            this.renderClients(config.clients || []);
            document.getElementById('enableService').checked = config.general?.enabled !== false;
            document.getElementById('logLevel').value = config.general?.log_level || 'info';

            // Render Topology
            this.renderTopology(config.clients || [], config.servers || []);

        } catch (err) {
            console.error('Failed to load config:', err);
            this.showError('Failed to load configuration', err.message);
        }
    },

    async loadStatus() {
        try {
            const resp = await this.fetchWithError(CONFIG.API.STATUS);
            const status = await resp.json();
            this.updateServiceStatus(status);
            this.updateTunnelStatus(status.processes || []);
            this.updateDiagnostics(status); // Pass status to diagnostics

            // Update Topology Animation
            // Update Topology Animation
            this.lastStatus = status;
            if (this.lastConfig) {
                this.renderTopology(this.lastConfig.clients || [], this.lastConfig.servers || []);
            }
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
                <td>${p.type === 'client' ? t('mode.client') : t('mode.server')}</td>
                <td><span class="status-badge ${p.running ? 'running' : 'stopped'}">${p.running ? t('status.running') : t('status.stopped')}</span></td>
                <td>${this.escapeHtml(p.local || '-')}</td>
                <td>${this.escapeHtml(p.remote || '-')}</td>
            </tr>
        `).join('');
    },

    updateDiagnostics(status) {
        if (!status?.diagnostics) {
            return;
        }
        const d = status.diagnostics;

        // 1. Binaries
        const tbodyBin = document.getElementById('diagBinariesBody');
        const binClient = d.binaries?.client || 'missing';
        const binServer = d.binaries?.server || 'missing';
        // Check if both present (simple check, or use d.binaries.ok)

        tbodyBin.innerHTML = `
            <tr>
                <td>Client Binary</td>
                <td>${binClient !== 'missing' ? '<span class="status-badge running">Present</span>' : '<span class="status-badge stopped">Missing</span>'}</td>
                <td class="text-mono">${binClient !== 'missing' ? this.escapeHtml(binClient) : '-'}</td>
            </tr>
            <tr>
                <td>Server Binary</td>
                <td>${binServer !== 'missing' ? '<span class="status-badge running">Present</span>' : '<span class="status-badge stopped">Missing</span>'}</td>
                <td class="text-mono">${binServer !== 'missing' ? this.escapeHtml(binServer) : '-'}</td>
            </tr>
        `;

        // 2. Interfaces
        const tbodyIf = document.getElementById('diagInterfacesBody');
        const ifaces = d.interfaces || [];
        if (ifaces.length === 0) {
            tbodyIf.innerHTML = '<tr><td colspan="3" class="text-muted" style="text-align:center;">No TUN interfaces found</td></tr>';
        } else {
            tbodyIf.innerHTML = ifaces.map(i => `
                <tr>
                    <td class="text-mono bold">${this.escapeHtml(i.name)}</td>
                    <td><span class="status-badge ${i.status === 'UP' ? 'running' : 'stopped'}">${this.escapeHtml(i.status)}</span></td>
                    <td class="text-mono text-xs">${this.escapeHtml((i.addrs || []).join(', '))}</td>
                </tr>
            `).join('');
        }

        // 3. Firewall
        const tbodyFw = document.getElementById('diagFirewallBody');
        const ipt = d.iptables || {};

        // Handle legacy string response just in case
        if (typeof ipt === 'string') {
            tbodyFw.innerHTML = `<tr><td colspan="3">${this.escapeHtml(ipt)}</td></tr>`;
        } else {
            // Expecting map { masquerade: N, dnat: N, total: N }
            tbodyFw.innerHTML = `
                <tr>
                    <td>MASQUERADE</td>
                    <td class="text-mono bold">${ipt.masquerade || 0}</td>
                    <td>${(ipt.masquerade > 0) ? '<span class="text-success">Active</span>' : '<span class="text-muted">Inactive</span>'}</td>
                </tr>
                <tr>
                    <td>DNAT</td>
                    <td class="text-mono bold">${ipt.dnat || 0}</td>
                    <td>${(ipt.dnat > 0) ? '<span class="text-success">Active</span>' : '<span class="text-muted">Inactive</span>'}</td>
                </tr>
                <tr>
                    <td class="bold">Total Rules</td>
                    <td class="text-mono bold">${ipt.total || 0}</td>
                    <td>${(ipt.total > 0) ? '<span class="text-success">System OK</span>' : '<span class="text-warning">Check Config</span>'}</td>
                </tr>
             `;
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
                <td><input type="checkbox" ${srv.enabled ? 'checked' : ''} onchange="app.toggleInstance('server', ${idx})"></td>
                <td>${this.escapeHtml(srv.local_port || '-')}</td>
                <td>${this.escapeHtml(srv.remote_addr || '-')}</td>
                <td>${this.escapeHtml(srv.remote_port || '-')}</td>
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
                <td><input type="checkbox" ${cli.enabled ? 'checked' : ''} onchange="app.toggleInstance('client', ${idx})"></td>
                <td>${this.escapeHtml(cli.remote_addr || '-')}</td>
                <td>${this.escapeHtml(cli.remote_port || '-')}</td>
                <td>${this.escapeHtml(cli.local_port || '-')}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="app.openEditModal('client', ${idx})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteInstanceDirect('client', ${idx})">Delete</button>
                </td>
            </tr>
        `).join('');
    },

    async toggleInstance(mode, index) {
        try {
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();

            if (mode === 'server') {
                config.servers[index].enabled = !config.servers[index].enabled;
            } else {
                config.clients[index].enabled = !config.clients[index].enabled;
            }

            // Save immediately
            await this.fetchWithError(CONFIG.API.CONFIG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            // Reload to reflect state (and maybe trigger restart if needed but for now just save config)
            this.showSuccess(`Instance ${mode === 'server' ? 'server' : 'client'} #${index + 1} toggled.`);

            // Optionally auto-apply? For now, we just save config as user might want to toggle multiple.
            // But user expectation "click checkbox" usually implies "it works". 
            // Given the requirement "Live Checkboxes", we should probably apply. 
            // However, applying restarts EVERYTHING. Let's just save for now, or trigger apply if critical.
            // Let's stick to Save Only to avoid massive disruptions on every click, 
            // unless user clicks "Save & Apply". (Or we can make it auto-restart).
            // Re-reading expectation: "active/cancel". Let's auto-restart to be "Live".

            await this.fetchWithError(CONFIG.API.ACTION_RESTART, { method: 'POST' });
            this.loadConfig(); // Refresh UI

        } catch (err) {
            console.error('Failed to toggle instance:', err);
            this.showError('Failed to toggle instance', err.message);
            this.loadConfig(); // Revert UI on error
        }
    },

    openAddModal(mode) {
        this.currentMode = mode;
        this.editingIndex = null;

        document.getElementById('editModalTitle').textContent = mode === 'server' ? 'Add Server Instance' : 'Add Client Instance';
        document.getElementById('deleteBtn').style.display = 'none'; // Hide delete on add

        // Reset fields
        document.getElementById('editEnable').checked = true;
        document.getElementById('editAlias').value = '';
        document.getElementById('editTunLocal').value = '';
        document.getElementById('editTunPeer').value = '';
        document.getElementById('editTunName').value = '';
        document.getElementById('editTunLocalIPv6').value = '';
        document.getElementById('editTunPeerIPv6').value = '';
        document.getElementById('editHandshakeFile').value = '';

        // Server fields
        document.getElementById('editServerPort').value = '';
        document.getElementById('editForwardIp').value = '';
        document.getElementById('editForwardPort').value = '';

        // Client fields
        document.getElementById('editRemoteAddr').value = '';
        document.getElementById('editRemotePort').value = '';
        document.getElementById('editLocalPort').value = '';
        document.getElementById('editLocalAddr').value = '127.0.0.1';

        this.showModalFields(mode);
        this.openModal('editModal');
    },

    openEditModal(mode, index) {
        this.currentMode = mode;
        this.editingIndex = index;

        document.getElementById('editModalTitle').textContent = mode === 'server' ? 'Edit Server Instance' : 'Edit Client Instance';
        document.getElementById('deleteBtn').style.display = 'inline-block';

        this.showModalFields(mode);
        this.loadModalData(mode, index);
        this.openModal('editModal');
    },

    showModalFields(mode) {
        document.querySelectorAll('.server-field').forEach(el => el.style.display = mode === 'server' ? 'block' : 'none');
        document.querySelectorAll('.client-field').forEach(el => el.style.display = mode === 'client' ? 'block' : 'none');
        // Reset tabs to basic
        this.switchModalTab('basic');
    },

    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex'; // Ensure flex for centering
        }
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => modal.style.display = 'none', 200);
        }
    },

    async deleteInstance() {
        if (this.editingIndex === null) return;
        if (!confirm('Delete this instance?')) return;
        await this.deleteInstanceDirect(this.currentMode, this.editingIndex);
        this.closeModal('editModal');
    },

    async deleteInstanceDirect(mode, index) {
        try {
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();

            if (mode === 'server') {
                config.servers.splice(index, 1);
            } else {
                config.clients.splice(index, 1);
            }

            await this.fetchWithError(CONFIG.API.CONFIG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            this.showSuccess('Instance deleted');
            this.loadConfig();
        } catch (err) {
            this.showError('Failed to delete', err.message);
        }
    },

    importConfig(mode) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async ev => {
                try {
                    const data = JSON.parse(ev.target.result);
                    // Append imported items
                    const resp = await this.fetchWithError(CONFIG.API.CONFIG);
                    const config = await resp.json();

                    if (mode === 'server') {
                        if (Array.isArray(data)) config.servers.push(...data);
                        else config.servers.push(data);
                    } else {
                        if (Array.isArray(data)) config.clients.push(...data);
                        else config.clients.push(data);
                    }

                    await this.fetchWithError(CONFIG.API.CONFIG, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(config)
                    });
                    this.showSuccess('Configuration imported');
                    this.loadConfig();
                } catch (err) {
                    this.showError('Import failed', 'Invalid JSON file');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    exportConfig(mode) {
        // Export only the relevant section
        const config = this.lastConfig || {};
        const data = mode === 'server' ? config.servers : config.clients;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phantun-${mode}-config.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    async loadModalData(mode, index) {
        try {
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();
            const data = mode === 'server' ? config.servers[index] : config.clients[index];

            document.getElementById('editEnable').checked = data.enabled !== false;
            document.getElementById('editAlias').value = data.alias || '';
            document.getElementById('editTunLocal').value = data.tun_local || '';
            document.getElementById('editTunPeer').value = data.tun_peer || '';

            // Advanced Fields
            document.getElementById('editIPv4Only').checked = !!data.ipv4_only;
            document.getElementById('editTunName').value = data.tun_name || '';
            document.getElementById('editTunLocalIPv6').value = data.tun_local_ipv6 || '';
            document.getElementById('editTunPeerIPv6').value = data.tun_peer_ipv6 || '';
            document.getElementById('editHandshakeFile').value = data.handshake_file || '';

            if (mode === 'server') {
                // Fix Mapping: JSON local_port -> UI editServerPort
                document.getElementById('editServerPort').value = data.local_port || '';
                // Fix Mapping: JSON remote_addr -> UI editForwardIp
                document.getElementById('editForwardIp').value = data.remote_addr || '';
                // Fix Mapping: JSON remote_port -> UI editForwardPort
                document.getElementById('editForwardPort').value = data.remote_port || '';
            } else {
                document.getElementById('editRemoteAddr').value = data.remote_addr || '';
                document.getElementById('editRemotePort').value = data.remote_port || '';
                document.getElementById('editLocalPort').value = data.local_port || '';
                // Fix Mapping: JSON local_addr -> UI editLocalAddr
                document.getElementById('editLocalAddr').value = data.local_addr || '127.0.0.1';
            }
        } catch (err) {
            console.error('Failed to load instance data:', err);
            this.showError('Failed to load instance data', err.message);
            this.closeModal('editModal');
        }
    },

    // ... (showModalFields etc) ...

    async saveInstance() {
        try {
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();

            const instance = {
                enabled: document.getElementById('editEnable').checked,
                alias: document.getElementById('editAlias').value,
                tun_local: document.getElementById('editTunLocal').value,
                tun_peer: document.getElementById('editTunPeer').value,
                // Advanced
                ipv4_only: document.getElementById('editIPv4Only').checked,
                tun_name: document.getElementById('editTunName').value,
                tun_local_ipv6: document.getElementById('editTunLocalIPv6').value,
                tun_peer_ipv6: document.getElementById('editTunPeerIPv6').value,
                handshake_file: document.getElementById('editHandshakeFile').value
            };

            if (this.currentMode === 'server') {
                // Fix Mapping: UI editServerPort -> JSON local_port
                instance.local_port = document.getElementById('editServerPort').value;
                // Fix Mapping: UI editForwardIp -> JSON remote_addr
                instance.remote_addr = document.getElementById('editForwardIp').value;
                // Fix Mapping: UI editForwardPort -> JSON remote_port
                instance.remote_port = document.getElementById('editForwardPort').value;

                if (this.editingIndex !== null) {
                    config.servers[this.editingIndex] = instance;
                } else {
                    config.servers = config.servers || [];
                    config.servers.push(instance);
                }
            } else {
                instance.remote_addr = document.getElementById('editRemoteAddr').value;
                instance.remote_port = document.getElementById('editRemotePort').value;
                instance.local_port = document.getElementById('editLocalPort').value;
                // Fix Mapping: UI editLocalAddr -> JSON local_addr
                instance.local_addr = document.getElementById('editLocalAddr').value || '127.0.0.1';

                if (this.editingIndex !== null) {
                    config.clients[this.editingIndex] = instance;
                } else {
                    config.clients = config.clients || [];
                    config.clients.push(instance);
                }
            }

            await this.fetchWithError(CONFIG.API.CONFIG, {
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

    // ===== LOG FUNCTIONS =====

    startLogStream() {
        if (this.logEventSource) return;

        this.logEventSource = new EventSource(CONFIG.API.LOGS);

        this.logEventSource.onmessage = (event) => {
            try {
                const log = JSON.parse(event.data);
                this.appendLog(log);
            } catch (e) {
                // Ignore parse errors (like heartbeat)
            }
        };

        this.logEventSource.onerror = (err) => {
            console.error('Log stream error:', err);
            this.stopLogStream();
            // Retry after delay? For now just stop.
        };

        const btn = document.getElementById('logStreamBtn');
        if (btn) btn.textContent = 'Pause Refresh';
    },

    stopLogStream() {
        if (this.logEventSource) {
            this.logEventSource.close();
            this.logEventSource = null;
        }
        const btn = document.getElementById('logStreamBtn');
        if (btn) btn.textContent = 'Start Refresh';
    },

    toggleLogStream() {
        if (this.logEventSource) {
            this.stopLogStream();
        } else {
            this.startLogStream();
        }
    },

    downloadLogs() {
        const content = document.getElementById('logContent').innerText;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phantun-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    scrollLogsToTop() {
        const container = document.getElementById('logContent').parentElement;
        container.scrollTop = 0;
    },

    async saveAndApply() {
        try {
            // First save global settings
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();

            config.general = config.general || {};
            const enableEl = document.getElementById('enableService');
            // Check if element exists before accessing checked
            if (enableEl) {
                config.general.enabled = enableEl.checked;
            }
            const logLevelEl = document.getElementById('logLevel');
            if (logLevelEl) {
                config.general.log_level = logLevelEl.value;
            }

            await this.fetchWithError(CONFIG.API.CONFIG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            // Then restart
            await this.fetchWithError(CONFIG.API.ACTION_RESTART, { method: 'POST' });

            this.showSuccess('Settings saved and service restarted');
            this.loadConfig();
            this.loadStatus();
        } catch (err) {
            this.showError('Failed to apply settings', err.message);
        }
    },

    async saveOnly() {
        try {
            // Save global settings
            const resp = await this.fetchWithError(CONFIG.API.CONFIG);
            const config = await resp.json();

            config.general = config.general || {};
            const enableEl = document.getElementById('enableService');
            if (enableEl) config.general.enabled = enableEl.checked;

            const logLevelEl = document.getElementById('logLevel');
            if (logLevelEl) config.general.log_level = logLevelEl.value;

            await this.fetchWithError(CONFIG.API.CONFIG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            this.showSuccess('Settings saved (not applied)');
        } catch (err) {
            this.showError('Failed to save', err.message);
        }
    },

    async resetConfigWithConfirm() {
        if (!confirm('Are you sure you want to reset all configuration? This cannot be undone.')) return;
        try {
            await this.fetchWithError(CONFIG.API.CONFIG, {
                method: 'DELETE'
            });
            // Also restart?
            await this.fetchWithError(CONFIG.API.ACTION_RESTART, { method: 'POST' });
            this.showSuccess('Configuration reset');
            this.loadConfig();
        } catch (err) {
            this.showError('Failed to reset', err.message);
        }
    },

    appendLog(log) {
        const container = document.getElementById('logContent');
        const line = document.createElement('span');
        line.className = 'log-line';
        // Fix: Use log.content instead of log.message if message is missing
        const msg = log.content || log.message || JSON.stringify(log);
        line.textContent = `[${log.timestamp || new Date().toISOString()}] [${log.source || 'system'}] ${msg}`;
        container.appendChild(line);

        // Limit log lines
        const lines = container.querySelectorAll('.log-line');
        if (lines.length > CONFIG.LOG_MAX_LINES) {
            lines[0].remove();
        }

        // Update timestamp
        const now = new Date();
        const stamp = document.getElementById('logTimestamp');
        if (stamp) stamp.textContent = now.toLocaleTimeString();

        // Auto-scroll if near bottom
        const parent = container.parentElement;
        const isNearBottom = (parent.scrollTop + parent.clientHeight) >= (parent.scrollHeight - CONFIG.AUTO_SCROLL_THRESHOLD);
        if (isNearBottom) {
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



    renderTopology(clients, servers) {
        const container = document.getElementById('topology-map');
        if (!container) return;

        container.innerHTML = '';
        container.className = 'topology-container'; // Verify class

        const createSvgRow = (item, type, index) => {
            const isRunning = this.isProcessRunning(item.id, type);
            const isEnabled = item.enabled !== false;

            // Fetch Process Info for Dynamic Data
            const proc = this.lastStatus?.processes?.find(p => p.id === item.id);

            // Status Logic
            let statusClass = 'disabled';
            if (isEnabled) statusClass = isRunning ? 'active' : 'stopped';

            // Coordinates (4 Distinct Nodes)
            const y = 40;
            const x1 = 60;   // Local App/Service
            const x2 = 280;  // Phantun Local
            const x3 = 520;  // TCP Tunnel
            const x4 = 740;  // Remote Node

            // Colors & Direction
            const color = type === 'client' ? '#06b6d4' : '#f59e0b';
            const isServer = type === 'server';

            // Animation Path
            const animPath = isServer
                ? `M${x4} ${y} L${x1} ${y}`
                : `M${x1} ${y} L${x4} ${y}`;

            const fiberClass = `${statusClass} ${isServer ? 'reverse' : ''}`;

            // Data for labels
            // Node 1: UDP Interface (Local IP)
            const addr1 = proc?.local || (item.local_addr ? `${item.local_addr}:${item.local_port}` : '...');
            // Node 2/3: Tunnel Interface
            const addrTun = proc?.tun_local || item.tun_local || '...';
            // Node 4: Remote Address
            const addrRemote = proc?.remote || (item.remote_addr ? `${item.remote_addr}:${item.remote_port}` : '...');

            const iconLocal = isServer ? '📦' : '💻';
            const labelLocal = isServer ? (t('topo.service') || 'Service') : (t('topo.app') || 'App');
            const modeLabel = type === 'client' ? 'Client' : 'Server';

            return `
            <div class="topo-row">
                <div class="topo-label">
                    <span>${t(`topo.${type}`)}: ${this.escapeHtml(item.alias || item.id.substring(0, 8))}</span>
                    <span class="status-dot ${statusClass === 'active' ? 'running' : 'stopped'}"></span>
                </div>
                <svg class="topo-svg" viewBox="0 0 800 120" preserveAspectRatio="xMidYMid meet">
                    <!-- Layer 1: Fiber Connection -->
                    <path d="M${x1} ${y} L${x4} ${y}" class="fiber-line ${fiberClass}"></path>

                    <!-- === NODE 1: Local UDP App/Service === -->
                    <circle cx="${x1}" cy="${y}" r="22" class="node-circle ${type}"></circle>
                    <text x="${x1}" y="${y}" class="node-icon" style="font-size:20px">${iconLocal}</text>
                    <text x="${x1}" y="${y + 35}" class="node-text">${labelLocal}</text>
                    <text x="${x1}" y="${y + 55}" class="node-subtext" style="font-size:12px; font-weight:bold;">${this.escapeHtml(addr1)}</text>

                    <!-- === NODE 2: Phantun Local (Ghost) === -->
                    <circle cx="${x2}" cy="${y}" r="24" class="node-circle" style="stroke:${color}; fill:#1e293b"></circle>
                    <text x="${x2}" y="${y}" class="node-icon" style="font-size:22px">👻</text>
                    <text x="${x2}" y="${y + 35}" class="node-text" style="fill:${color}">Phantun ${modeLabel}</text>
                    
                    <!-- === NODE 3: TCP Tunnel === -->
                    <circle cx="${x3}" cy="${y}" r="22" class="node-circle internet"></circle>
                    <text x="${x3}" y="${y}" class="node-icon" style="font-size:20px">🔗</text>
                    <text x="${x3}" y="${y + 35}" class="node-text" style="fill:#94a3b8">TCP Tunnel</text>
                    <text x="${x3}" y="${y + 55}" class="node-subtext" style="font-size:12px; font-weight:bold;">${this.escapeHtml(addrTun)}</text>

                    <!-- === NODE 4: Remote Node === -->
                    <circle cx="${x4}" cy="${y}" r="22" class="node-circle ${type}"></circle>
                    <text x="${x4}" y="${y}" class="node-icon" style="font-size:20px">☁️</text>
                    <text x="${x4}" y="${y + 35}" class="node-text">${t('topo.remote')}</text>
                    <text x="${x4}" y="${y + 55}" class="node-subtext" style="font-size:12px; font-weight:bold;">${this.escapeHtml(addrRemote)}</text>

                    ${statusClass === 'active' ? `
                    <circle r="5" class="pulse-packet active">
                        <animateMotion dur="3s" repeatCount="indefinite" path="${animPath}" keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                    </circle>
                    <circle r="5" class="pulse-packet active">
                        <animateMotion dur="3s" begin="1s" repeatCount="indefinite" path="${animPath}" keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                    </circle>
                    <circle r="5" class="pulse-packet active">
                        <animateMotion dur="3s" begin="2s" repeatCount="indefinite" path="${animPath}" keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                    </circle>
                    ` : ''}
                </svg>
            </div>
            `;
        };

        let html = '';
        if (clients.length === 0 && servers.length === 0) {
            html = '<div class="text-center text-secondary p-4">No instances configured.</div>';
        } else {
            clients.forEach((c, i) => html += createSvgRow(c, 'client', i));
            servers.forEach((s, i) => html += createSvgRow(s, 'server', i));
        }

        container.innerHTML = html;
    },

    isProcessRunning(configId, type) {
        // Find in logic processes list (status data)
        // Since loadConfig and loadStatus might be async out of sync, 
        // we'll rely on the visual indicator matching 'enabled' for now, 
        // OR ideally check against this.lastStatus
        if (!this.lastStatus || !this.lastStatus.processes) return false;

        const proc = this.lastStatus.processes.find(p => p.id === configId);
        return proc ? proc.running : false;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ===== HEADER TOOLBAR FUNCTIONS =====

    toggleLanguage() {
        const newLang = currentLang === 'en' ? 'zh' : 'en';
        updateLanguage(newLang);
        this.showSuccess(`Language switched to ${newLang === 'en' ? 'English' : '中文'}`);
    },

    toggleTheme() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);

        this.showSuccess(`Theme switched to ${newTheme} mode`);
    },



    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        const savedLang = localStorage.getItem('lang') || 'en';

        document.documentElement.setAttribute('data-theme', savedTheme);

        const langText = document.querySelector('.btn-lang-text');
        if (langText) {
            langText.textContent = savedLang.toUpperCase();
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    app.initTheme();
    app.init();
});
