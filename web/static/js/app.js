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

// ===== APPLICATION =====
// Phantun Manager Application
const app = {
    currentMode: null, // 'server' or 'client'
    editingIndex: null,
    logStream: null,
    logStreaming: false,

    init() {
        // this.setupTabs(); // Removed, using inline onclick
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
            if (targetId === 'dashboardPage' && typeof topology !== 'undefined') {
                if (this.lastConfig) topology.render(this.lastConfig);
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
            this.lastConfig = config;
            this.renderServers(config.servers || []);
            this.renderClients(config.clients || []);
            document.getElementById('enableService').checked = config.general?.enabled !== false;
            document.getElementById('logLevel').value = config.general?.log_level || 'info';

            // Render Topology if available
            if (typeof topology !== 'undefined') {
                topology.render(config);
            }
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
            if (typeof topology !== 'undefined') {
                topology.updateStatus(status.processes || []);
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
                <td>${p.type === 'client' ? 'Client' : 'Server'}</td>
                <td><span class="status-badge ${p.running ? 'running' : 'stopped'}">${p.running ? 'Running' : 'Stopped'}</span></td>
                <td>${this.escapeHtml(p.local || '-')}</td>
                <td>${this.escapeHtml(p.remote || '-')}</td>
                <td>${this.escapeHtml(p.tun_local || '-')} ↔ ${this.escapeHtml(p.tun_peer || '-')}</td>
                <td>${p.pid || '-'}</td>
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

    // ... (openAddModal etc) ...

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

    // ... 

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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ===== HEADER TOOLBAR FUNCTIONS =====

    toggleLanguage() {
        const currentLang = localStorage.getItem('lang') || 'en';
        const newLang = currentLang === 'en' ? 'zh' : 'en';
        localStorage.setItem('lang', newLang);

        // Update button text
        const langText = document.querySelector('.btn-lang-text');
        if (langText) {
            langText.textContent = newLang.toUpperCase();
        }

        // Apply translations
        this.applyTranslations(newLang);
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

    applyTranslations(lang) {
        const translations = {
            en: {
                'Phantun Manager': 'Phantun Manager',
                'Dashboard': 'Dashboard',
                'Configuration': 'Configuration',
                'Service Status:': 'Service Status:',
                'Tunnel Status': 'Tunnel Status',
                'System Diagnostics': 'System Diagnostics',
                'Recent Logs': 'Recent Logs',
                'Global Settings': 'Global Settings',
                'Server Instances': 'Server Instances',
                'Client Instances': 'Client Instances',
                'Save & Apply': 'Save & Apply',
                'Save Only': 'Save Only',
                'Reset': 'Reset',
                'Logout': 'Logout'
            },
            zh: {
                'Phantun Manager': 'Phantun 管理器',
                'Dashboard': '仪表板',
                'Configuration': '配置',
                'Service Status:': '服务状态：',
                'Tunnel Status': '隧道状态',
                'System Diagnostics': '系统诊断',
                'Recent Logs': '最近日志',
                'Global Settings': '全局设置',
                'Server Instances': '服务端实例',
                'Client Instances': '客户端实例',
                'Save & Apply': '保存并应用',
                'Save Only': '仅保存',
                'Reset': '重置',
                'Logout': '退出登录'
            }
        };

        const t = translations[lang];

        // Apply translations to common elements
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (t[key]) {
                el.textContent = t[key];
            }
        });

        // Update specific elements by selector
        const updateText = (sel, key) => {
            const el = document.querySelector(sel);
            if (el && t[key]) el.textContent = t[key];
        };

        updateText('.header-title', 'Phantun Manager');
        updateText('[data-target="dashboardPage"]', 'Dashboard');
        updateText('[data-target="configPage"]', 'Configuration');
    },

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        const savedLang = localStorage.getItem('lang') || 'en';

        document.documentElement.setAttribute('data-theme', savedTheme);

        const langText = document.querySelector('.btn-lang-text');
        if (langText) {
            langText.textContent = savedLang.toUpperCase();
        }

        this.applyTranslations(savedLang);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    app.initTheme();
    app.init();
});
