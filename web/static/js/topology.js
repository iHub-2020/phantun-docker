const topology = {
    svg: null,
    width: 0,
    height: 0,
    config: null,
    statusMap: {},

    updateStatus: (processes) => {
        // processes is array of {id, running, ...}
        if (!processes) return;
        processes.forEach(p => {
            topology.statusMap[p.id] = p.running;
        });
        topology.render(topology.config); // Re-render to update animations
    },

    render: (config) => {
        topology.config = config;
        const container = document.getElementById('topology-map');
        if (!container) return;

        container.innerHTML = '';
        topology.width = container.clientWidth;
        topology.height = container.clientHeight;

        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        container.appendChild(svg);
        topology.svg = svg;

        // Calculate positions
        const clients = config.clients || [];
        const servers = config.servers || [];
        const all = [...clients, ...servers];

        if (all.length === 0) {
            const text = document.createElementNS(ns, "text");
            text.setAttribute("x", "50%");
            text.setAttribute("y", "50%");
            text.setAttribute("fill", "#64748B");
            text.setAttribute("text-anchor", "middle");
            text.textContent = "No instances configured";
            svg.appendChild(text);
            return;
        }

        const rowHeight = 80;
        const startY = 50;

        // Columns: [Local App] <---> [Phantun Local] ============= [Phantun Remote] <---> [Real Remote]
        // But Phantun logic is:
        // Client: Local App -> [LocalAddr:LocalPort] -> (TunLocal -> TunPeer) -> RemoteAddr
        // Server: Remote -> [LocalPort] -> (TunLocal -> TunPeer) -> RemoteAddr

        // To simplify, we visualize the "Flow" defined by the config.
        // For Client: App -> Phantun Client -> Internet -> Phantun Server (Abstract)
        // For Server: Internet -> Phantun Server -> App

        // Let's draw each instance as a row.

        all.forEach((item, index) => {
            const y = startY + (index * rowHeight);
            const isClient = !!item.local_addr; // rudimentary check or use ID check against lists
            // Actually app.js passes raw config lists. We need to know type.
            // Let's deduce type by checking presence in lists
            const type = config.clients.find(c => c.id === item.id) ? 'client' : 'server';
            const isRunning = topology.statusMap[item.id];
            const color = isRunning ? '#22C55E' : '#64748B';

            // Group
            const g = document.createElementNS(ns, "g");
            svg.appendChild(g);

            // Draw Nodes
            const xLeft = 50;
            const xMid = topology.width / 2;
            const xRight = topology.width - 50;

            // Text Label
            const label = document.createElementNS(ns, "text");
            label.setAttribute("x", 10);
            label.setAttribute("y", y - 20);
            label.setAttribute("fill", "#F8FAFC");
            label.setAttribute("font-size", "12");
            label.textContent = `${type.toUpperCase()}: ${item.alias}`;
            g.appendChild(label);

            // 1. Node A (Local)
            topology.drawNode(g, xLeft, y, "Local", color);

            // 2. Node B (Phantun Instance)
            topology.drawNode(g, xMid, y, "Phantun", color);

            // 3. Node C (Remote)
            topology.drawNode(g, xRight, y, "Remote", color);

            // Links
            topology.drawLink(g, xLeft + 20, y, xMid - 20, y, isRunning);
            topology.drawLink(g, xMid + 20, y, xRight - 20, y, isRunning);
        });
    },

    drawNode: (parent, x, y, label, color) => {
        const ns = "http://www.w3.org/2000/svg";
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", 15);
        circle.setAttribute("fill", "#0F172A");
        circle.setAttribute("stroke", color);
        circle.setAttribute("stroke-width", "2");
        parent.appendChild(circle);

        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y + 30);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", "#94A3B8");
        text.textContent = label;
        parent.appendChild(text);
    },

    drawLink: (parent, x1, y1, x2, y2, animate) => {
        const ns = "http://www.w3.org/2000/svg";
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", animate ? "#3B82F6" : "#334155");
        line.setAttribute("stroke-width", "2");

        if (animate) {
            line.setAttribute("stroke-dasharray", "5,5");
            // Animation
            const anim = document.createElementNS(ns, "animate");
            anim.setAttribute("attributeName", "stroke-dashoffset");
            anim.setAttribute("from", "10");
            anim.setAttribute("to", "0");
            anim.setAttribute("dur", "1s");
            anim.setAttribute("repeatCount", "indefinite");
            line.appendChild(anim);
        }

        parent.appendChild(line);
    }
};
