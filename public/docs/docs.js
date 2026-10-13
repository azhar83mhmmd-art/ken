document.addEventListener("DOMContentLoaded", init);

let globalConfig = null;
let toastTimeout;
let routesById = {};
let exampleSnippets = {};
let terminalLoading = true;
let terminalAutoScroll = true;

const revealObserver = new IntersectionObserver(
    entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("in");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.08 }
);

function observeReveals(root) {
    (root || document).querySelectorAll(".reveal").forEach(el => {
        if (!el.dataset.observed) {
            el.dataset.observed = "1";
            revealObserver.observe(el);
        }
    });
}

async function init() {
    observeReveals();
    setupSidebarEvents();

    if (!document.getElementById("term-logs")) return;

    const terminal = document.getElementById("term-logs");
    terminal.addEventListener("scroll", () => {
        const distance = terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop;
        terminalAutoScroll = distance < 48;
    });

    try {
        const t0 = performance.now();
        const response = await fetch("/config");
        globalConfig = await response.json();
        const ping = Math.round(performance.now() - t0);

        setUi(globalConfig);
        buildSidebarTree(globalConfig.tags);
        renderIntro(globalConfig);
        updateHeroStats(globalConfig, ping);
        setupFilters();
        setupHeroButtons();
        handleDeepLink();
        window.addEventListener("hashchange", handleDeepLink);
        startWIBClock();
        initBattery();
        initDevice();
        await kuroneko(globalConfig);
        setSearch();
    } catch (e) {
        document.getElementById("term-logs").innerHTML = `
            <span class="text-red-400 font-bold">SYSTEM FAILURE</span><br>
            ${e.message}
        `;
    }
}

/* ===================== v4 helpers ===================== */
function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

const CAT_ICONS = {
    ai: "fa-robot", download: "fa-cloud-arrow-down", info: "fa-circle-info",
    maker: "fa-wand-magic-sparkles", music: "fa-music", random: "fa-shuffle",
    search: "fa-magnifying-glass", tools: "fa-screwdriver-wrench", upload: "fa-cloud-arrow-up",
    stalk: "fa-user-secret", anime: "fa-face-smile-beam", game: "fa-gamepad", news: "fa-newspaper"
};

function catIcon(cat) {
    return CAT_ICONS[String(cat).toLowerCase()] || "fa-folder";
}

function methodClassOf(method) {
    return method === "GET" ? "get" : method === "POST" ? "post" : method === "DELETE" ? "delete" : "other";
}

function updateHeroStats(config, ping) {
    const tags = config.tags || {};
    const cats = Object.keys(tags);
    const total = cats.reduce((n, c) => n + (Array.isArray(tags[c]) ? tags[c].length : 0), 0);
    const e = document.getElementById("doc-stat-endpoints");
    const c = document.getElementById("doc-stat-cats");
    const p = document.getElementById("doc-stat-ping");
    if (e) e.textContent = String(total);
    if (c) c.textContent = String(cats.length);
    if (p) p.textContent = ping + "ms";
}

function setupHeroButtons() {
    const b = document.getElementById("hero-browse");
    if (b) b.addEventListener("click", openSidebar);
}

let activeMethod = "all";

function setupFilters() {
    const wrap = document.getElementById("method-filters");
    if (!wrap) return;
    wrap.addEventListener("click", e => {
        const btn = e.target.closest(".chip-btn");
        if (!btn) return;
        activeMethod = btn.getAttribute("data-method") || "all";
        wrap.querySelectorAll(".chip-btn").forEach(b => b.classList.toggle("active", b === btn));
        applyFilter();
    });
}

window.openCategory = cat => {
    openSidebar();
    const catId = `cat-${String(cat).replace(/\s+/g, "-")}`;
    const files = document.getElementById(`files-${catId}`);
    const arrow = document.getElementById(`arrow-${catId}`);
    if (!files) return;
    files.classList.remove("hidden");
    if (arrow) arrow.classList.add("rotate-180");
    setTimeout(() => {
        const wrap = files.closest(".folder-wrap");
        if (wrap) wrap.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 120);
};

function handleDeepLink() {
    const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (!h) return;
    if (h.startsWith("ep=")) {
        const id = h.slice(3);
        if (routesById[id]) selectEndpoint(id);
    } else if (h.startsWith("cat=")) {
        window.openCategory(h.slice(4));
    }
}

window.copyBlock = (id, btn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.innerText || el.textContent || "";
    const done = () => {
        if (btn) {
            const old = btn.innerHTML;
            btn.classList.add("done");
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Tersalin';
            setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = old; }, 1600);
        }
        messeg("KODE DISALIN");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
    }
};

window.copyLink = id => {
    const url = location.origin + location.pathname + "#ep=" + encodeURIComponent(id);
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    messeg("LINK DISALIN");
};

function applyFilter() {
    const input = document.getElementById("search-input");
    const noResults = document.getElementById("no-results");
    const val = (input ? input.value : "").toLowerCase().trim();
    const m = activeMethod;
    const filtering = val !== "" || m !== "all";
    let anyVisible = false;

    document.querySelectorAll(".folder-wrap").forEach(w => {
        const files = w.querySelector(".folder-files");
        const arrow = w.querySelector(".folder-arrow");
        let match = 0;

        w.querySelectorAll(".file-item").forEach(f => {
            const okText = !val || (f.getAttribute("data-search") || "").includes(val);
            const okMethod = m === "all" || f.getAttribute("data-method") === m;
            const ok = okText && okMethod;
            f.classList.toggle("hidden", !ok);
            if (ok) match++;
        });

        if (!filtering) {
            w.classList.remove("hidden");
            files.classList.add("hidden");
            arrow.classList.remove("rotate-180");
            anyVisible = true;
        } else if (match > 0) {
            w.classList.remove("hidden");
            files.classList.remove("hidden");
            arrow.classList.add("rotate-180");
            anyVisible = true;
        } else {
            w.classList.add("hidden");
        }
    });

    if (noResults) {
        noResults.classList.toggle("hidden", anyVisible);
        noResults.classList.toggle("flex", !anyVisible);
    }
}

function messeg(msg) {
    const toast = document.getElementById("custom-toast");
    const msgBox = document.getElementById("toast-message");

    if (!toast || !msgBox) return;

    msgBox.innerText = msg;
    toast.classList.remove("translate-y-32", "opacity-0");

    if (toastTimeout) clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
        toast.classList.add("translate-y-32", "opacity-0");
    }, 3000);
}

function startWIBClock() {
    const timeEl = document.getElementById("server-time");
    const dateEl = document.getElementById("server-date");

    updateTime();
    setInterval(updateTime, 1000);

    function updateTime() {
        const now = new Date();

        if (timeEl) {
            timeEl.innerText = now.toLocaleTimeString("id-ID", {
                timeZone: "Asia/Jakarta",
                hour12: false
            });
        }

        if (dateEl) {
            dateEl.innerText = now.toLocaleDateString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "2-digit",
                month: "short",
                year: "numeric"
            });
        }
    }
}

async function initBattery() {
    const batEl = document.getElementById("stat-battery");

    if (!batEl) return;

    if ("getBattery" in navigator) {
        try {
            const battery = await navigator.getBattery();

            const updateBat = () => {
                batEl.innerText = `${Math.round(battery.level * 100)}% ${battery.charging ? "⚡" : ""}`;
            };

            updateBat();
            battery.addEventListener("levelchange", updateBat);
            battery.addEventListener("chargingchange", updateBat);
        } catch (e) {
            batEl.innerText = "--%";
        }
    } else {
        batEl.innerText = "N/A";
    }
}

function initDevice() {
    const devEl = document.getElementById("stat-device");

    if (!devEl) return;

    const ua = navigator.userAgent.toLowerCase();
    let device = "Unknown";

    if (ua.includes("windows phone")) {
        device = "Windows Phone";
    } else if (ua.includes("windows")) {
        device = "Windows";
    } else if (ua.includes("android")) {
        device = "Android";
    } else if (
        ua.includes("iphone") ||
        ua.includes("ipad") ||
        ua.includes("ipod")
    ) {
        device = "iOS";
    } else if (ua.includes("mac")) {
        device = "MacOS";
    } else if (ua.includes("linux")) {
        device = "Linux";
    }

    devEl.innerText = device;
}

function terminalScrollToBottom(force = false) {
    const logs = document.getElementById("term-logs");
    if (!logs) return;
    if (force || (terminalLoading && terminalAutoScroll)) {
        requestAnimationFrame(() => { logs.scrollTop = logs.scrollHeight; });
    }
}

function terminalLog(message, type = "info") {
    const logs = document.getElementById("term-logs");

    if (!logs) return;

    const line = document.createElement("div");
    let color = "text-slate-300";

    if (type === "error") {
        color = "text-rose-400";
    } else if (type === "success") {
        color = "text-emerald-400";
    } else if (type === "warn") {
        color = "text-amber-400";
    } else if (type === "system") {
        color = "text-slate-500";
    }

    line.className = `${color} break-all`;
    line.innerHTML = message;

    logs.appendChild(line);
    terminalScrollToBottom();
}

async function kuroneko(config) {
    terminalLoading = true;
    terminalAutoScroll = true;
    const logs = document.getElementById("term-logs");

    if (!logs) return;

    const cmdLine = document.createElement("div");
    cmdLine.className = "text-slate-300 break-all";
    cmdLine.innerHTML = `
        <span class="text-emerald-400">➜</span>
        <span class="text-sky-400">~</span>
    `;

    const typeSpan = document.createElement("span");
    typeSpan.className = "text-white font-bold";

    cmdLine.appendChild(typeSpan);
    logs.appendChild(cmdLine);

    const commandText = "npm run dev";
    terminalScrollToBottom(true);

    for (let i = 0; i < commandText.length; i++) {
        typeSpan.textContent += commandText.charAt(i);
        terminalScrollToBottom();
        await new Promise(resolve => setTimeout(resolve, 55));
    }

    await new Promise(resolve => setTimeout(resolve, 400));

    const ver = config.settings.apiVersion || "1.0.0";

    terminalLog(`> kairoo-api@${ver} dev`, "system");
    terminalLog("> ts-node src/index.ts", "system");

    await new Promise(resolve => setTimeout(resolve, 500));

    terminalLog("", "system");

    const allRoutes = [];

    for (const cat in config.tags) {
        config.tags[cat].forEach(route => {
            allRoutes.push({ cat, ...route });
        });
    }

    for (const route of allRoutes) {
        const color =
            route.method === "GET"
                ? "text-sky-400"
                : route.method === "POST"
                    ? "text-emerald-400"
                    : "text-amber-400";

        terminalLog(
            `[ + ] <span class="${color} font-bold w-12 inline-block">${route.method}</span> ${route.endpoint} <span class="text-slate-600">✓</span>`,
            "info"
        );

        await new Promise(resolve => setTimeout(resolve, 14));
    }

    await new Promise(resolve => setTimeout(resolve, 400));

    terminalLog("", "system");
    terminalLog(
        `[ ✓ ] Server running on ${window.location.origin}`,
        "success"
    );

    terminalLoading = false;
    terminalAutoScroll = false;
    terminalScrollToBottom(true);
    document.getElementById("term-input-line").classList.remove("hidden");
}

function setUi(config) {
    const s = config.settings;
    const navTitle = document.getElementById("nav-title");

    if (navTitle) {
        navTitle.innerText = s.apiName || "API";
    }

    if (s.favicon) {
        let link = document.querySelector("link[rel~='icon']");

        if (!link) {
            link = document.createElement("link");
        }

        link.rel = "icon";
        link.href = s.favicon;

        document.head.appendChild(link);
    }
}

function buildExampleSnippets(origin, endpoint) {
    const url = `${origin}${endpoint}`;

    return {
        curl: `curl -X GET "${url}"`,

        javascript: `fetch("${url}")
  .then(res => res.json())
  .then(data => console.log(data));`,

        nodejs: `const https = require("https");

https.get("${url}", (res) => {
  let data = "";

  res.on("data", chunk => data += chunk);
  res.on("end", () => console.log(JSON.parse(data)));
});`,

        python: `import requests

response = requests.get("${url}")
print(response.json())`,

        php: `<?php

$response = file_get_contents("${url}");
$data = json_decode($response, true);
print_r($data);`,

        java: `HttpClient client = HttpClient.newHttpClient();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${url}"))
    .GET()
    .build();

HttpResponse<String> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofString()
);

System.out.println(response.body());`,

        golang: `resp, err := http.Get("${url}")

if err != nil {
    panic(err)
}

defer resp.Body.Close()

body, _ := io.ReadAll(resp.Body)
fmt.Println(string(body))`
    };
}

function langLabel(lang) {
    const map = {
        curl: "cURL",
        javascript: "JavaScript",
        nodejs: "Node.js",
        python: "Python",
        php: "PHP",
        java: "Java",
        golang: "Go"
    };

    return map[lang] || lang;
}

window.switchLangTab = lang => {
    const code = document.getElementById("example-code");

    if (code) {
        code.innerText = exampleSnippets[lang] || "";
    }

    const lbl = document.getElementById("example-lang");
    if (lbl) lbl.textContent = langLabel(lang);

    document.querySelectorAll(".lang-tab").forEach(tab => {
        tab.classList.toggle(
            "active",
            tab.getAttribute("data-lang") === lang
        );
    });
};

function buildResponseExamples() {
    return {
        success: JSON.stringify(
            {
                creator: "Kenz",
                status: true,
                result: [
                    {
                        title: "Billie Eilish - WILDFLOWER (Official Lyric Video)",
                        thumbnail: "https://i.ytimg.com/vi/l08Zw-RY__Q/hq720.jpg",
                        duration: "4.22",
                        uploaded: "2 tahun yang lalu",
                        views: "382.992.956 x ditonton",
                        url: "https://youtu.be/l08Zw-RY__Q",
                        videoId: "l08Zw-RY__Q"
                    }
                ]
            },
            null,
            2
        ),

        error: JSON.stringify(
            {
                creator: "Kenz",
                status: false,
                message: "Internal server error"
            },
            null,
            2
        ),

        ratelimit: JSON.stringify(
            {
                creator: "Kenz",
                status: false,
                message: "Too many requests. You are temporarily banned"
            },
            null,
            2
        )
    };
}

function buildStatusCodes() {
    return [
        {
            code: "200",
            cls: "c2xx",
            label: "OK",
            desc: "Request successful, result returned in the response body."
        },
        {
            code: "400",
            cls: "c4xx",
            label: "Bad Request",
            desc: "Missing or invalid parameters in the request."
        },
        {
            code: "404",
            cls: "c4xx",
            label: "Not Found",
            desc: "Endpoint does not exist."
        },
        {
            code: "429",
            cls: "c429",
            label: "Too Many Requests",
            desc: "Rate limit exceeded, client is temporarily banned."
        },
        {
            code: "500",
            cls: "c5xx",
            label: "Internal Server Error",
            desc: "Unexpected error occurred on the server."
        }
    ];
}

function renderIntro(config) {
    const el = document.getElementById("intro-view");

    if (!el) return;

    const origin = window.location.origin;
    const cats = Object.keys(config.tags || {});
    const firstCat = cats[0];
    const firstRoute = firstCat
        ? config.tags[firstCat][0]
        : null;

    const exampleEndpoint = firstRoute
        ? firstRoute.endpoint
        : "/api/info/ping";

    const apiName = config.settings.apiName || "Kairoo API";

    exampleSnippets = buildExampleSnippets(
        origin,
        exampleEndpoint
    );

    const responses = buildResponseExamples();
    const statusCodes = buildStatusCodes();

    const langs = [
        "curl",
        "javascript",
        "nodejs",
        "python",
        "php",
        "java",
        "golang"
    ];

    const tabsHtml = langs
        .map(
            (lang, i) => `
                <button
                    class="lang-tab ${i === 0 ? "active" : ""}"
                    data-lang="${lang}"
                    onclick="switchLangTab('${lang}')"
                >
                    ${langLabel(lang)}
                </button>
            `
        )
        .join("");

    const rowsHtml = statusCodes
        .map(
            status => `
                <tr>
                    <td>
                        <span class="status-code ${status.cls}">
                            ${status.code}
                        </span>
                    </td>
                    <td>${status.label}</td>
                    <td>${status.desc}</td>
                </tr>
            `
        )
        .join("");

    const catCards = cats
        .map(cat => {
            const n = (config.tags[cat] || []).length;
            return `
                <button type="button" class="doc-cat" data-cat="${escHtml(cat)}">
                    <span class="ic"><i class="fa-solid ${catIcon(cat)}"></i></span>
                    <b>${escHtml(cat)}</b>
                    <small>${n} endpoint</small>
                </button>
            `;
        })
        .join("");

    el.innerHTML = `
        <div class="flex items-center gap-4 mb-5">
            <div class="intro-icon shrink-0"><i class="fa-solid fa-book-open"></i></div>
            <div class="min-w-0">
                <h2 class="font-black text-xl leading-tight" style="color:#0A0A0A">Introduction</h2>
                <p class="text-xs font-bold" style="color:#3A3A3A">Panduan singkat memakai ${escHtml(apiName)}</p>
            </div>
        </div>

        <p class="text-sm leading-relaxed font-semibold mb-6" style="color:#2B2B2B">
            Selamat datang di dokumentasi ${escHtml(apiName)}. Pilih kategori di bawah,
            atau tekan <b>Ctrl&nbsp;K</b> (di HP: tombol <i class="fa-solid fa-magnifying-glass text-[11px]"></i>) untuk mencari endpoint,
            lalu coba langsung dari halaman ini.
        </p>

        <h3 class="doc-h3">Kategori</h3>
        <div class="doc-cats">${catCards}</div>

        <h3 class="doc-h3">Contoh Penggunaan</h3>

        <div class="lang-tabs">${tabsHtml}</div>

        <div class="code-wrap">
            <span class="code-lang-label" id="example-lang">cURL</span>
            <button type="button" class="code-copy" onclick="copyBlock('example-code', this)"><i class="fa-regular fa-copy"></i> Salin</button>
            <div class="intro-code" id="example-code"></div>
        </div>

        <h3 class="doc-h3">Format Respons</h3>

        <div class="resp-examples" style="margin-top:6px">
            <div class="resp-card">
                <div class="resp-head">
                    <span class="resp-badge ok">200 OK</span>
                    <span class="resp-label">Success</span>
                </div>
                <div class="code-wrap" style="margin:0">
                    <button type="button" class="code-copy" onclick="copyBlock('resp-success', this)"><i class="fa-regular fa-copy"></i></button>
                    <div class="resp-code" id="resp-success"></div>
                </div>
            </div>

            <div class="resp-card">
                <div class="resp-head">
                    <span class="resp-badge err">500 Internal Server Error</span>
                    <span class="resp-label">Error</span>
                </div>
                <div class="code-wrap" style="margin:0">
                    <button type="button" class="code-copy" onclick="copyBlock('resp-error', this)"><i class="fa-regular fa-copy"></i></button>
                    <div class="resp-code" id="resp-error"></div>
                </div>
            </div>

            <div class="resp-card">
                <div class="resp-head">
                    <span class="resp-badge limit">429 Too Many Requests</span>
                    <span class="resp-label">Rate Limited</span>
                </div>
                <div class="code-wrap" style="margin:0">
                    <button type="button" class="code-copy" onclick="copyBlock('resp-ratelimit', this)"><i class="fa-regular fa-copy"></i></button>
                    <div class="resp-code" id="resp-ratelimit"></div>
                </div>
            </div>
        </div>

        <h3 class="doc-h3" style="margin-top:26px">Status Codes</h3>

        <div class="status-table-wrap">
            <table class="status-table">
                <thead>
                    <tr><th>Code</th><th>Status</th><th>Description</th></tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    `;

    el.querySelectorAll(".doc-cat").forEach(btn => {
        btn.addEventListener("click", () => window.openCategory(btn.getAttribute("data-cat")));
    });

    document.getElementById("example-code").innerText =
        exampleSnippets.curl;

    document.getElementById("resp-success").innerText =
        responses.success;

    document.getElementById("resp-error").innerText =
        responses.error;

    document.getElementById("resp-ratelimit").innerText =
        responses.ratelimit;
}

function buildSidebarTree(tags) {
    const tree = document.getElementById("sidebar-tree");

    if (!tree) return;

    tree.innerHTML = "";
    routesById = {};

    const introBtn = document.createElement("button");

    introBtn.id = "sidebar-intro-btn";
    introBtn.className = "folder-btn intro-nav-btn active";

    introBtn.innerHTML = `
        <div
            class="folder-icon"
            style="background:#4ADE80"
        >
            <i class="fa-solid fa-house"></i>
        </div>

        <span class="folder-title">
            Introduction
        </span>
    `;

    introBtn.addEventListener("click", () => {
        backToIntro();
        closeSidebar();
    });

    tree.appendChild(introBtn);

    for (const [cat, routes] of Object.entries(tags)) {
        const catId = `cat-${cat.replace(/\s+/g, "-")}`;
        const wrap = document.createElement("div");

        wrap.className = "folder-wrap";

        wrap.innerHTML = `
            <button
                class="folder-btn"
                onclick="toggleFolder('${catId}')"
            >
                <div class="folder-icon">
                    <i class="fa-solid fa-folder"></i>
                </div>

                <span class="folder-title">
                    ${cat}
                </span>

                <span class="folder-count">
                    ${routes.length}
                </span>

                <i
                    id="arrow-${catId}"
                    class="fa-solid fa-chevron-down folder-arrow"
                ></i>
            </button>

            <div
                id="files-${catId}"
                class="folder-files hidden"
            ></div>
        `;

        const filesEl = wrap.querySelector(
            `#files-${catId}`
        );

        routes.forEach((route, idx) => {
            const id = `${cat}-${idx}`.replace(/\s+/g, "-");

            routesById[id] = {
                cat,
                ...route
            };

            const methodClass =
                route.method === "GET"
                    ? "get"
                    : route.method === "POST"
                        ? "post"
                        : route.method === "DELETE"
                            ? "delete"
                            : "other";

            const btn = document.createElement("button");

            btn.className = "file-item";
            btn.id = `file-${id}`;
            btn.setAttribute("data-method", methodClass);

            btn.setAttribute(
                "data-search",
                `${route.name} ${route.endpoint} ${cat}`.toLowerCase()
            );

            btn.innerHTML = `
                <span class="mini-badge ${methodClass}">
                    ${route.method}
                </span>

                <span class="file-name">
                    ${route.name}
                </span>
            `;

            btn.addEventListener("click", () => {
                selectEndpoint(id);
            });

            filesEl.appendChild(btn);
        });

        tree.appendChild(wrap);
    }
}

window.toggleFolder = catId => {
    document
        .getElementById(`files-${catId}`)
        .classList.toggle("hidden");

    document
        .getElementById(`arrow-${catId}`)
        .classList.toggle("rotate-180");
};

function selectEndpoint(id) {
    const route = routesById[id];

    if (!route) return;

    document.querySelectorAll(".file-item").forEach(file => {
        file.classList.remove("active");
    });

    document
        .getElementById("sidebar-intro-btn")
        .classList.remove("active");

    const btn = document.getElementById(`file-${id}`);

    if (btn) {
        btn.classList.add("active");
    }

    renderEndpointCard(route, id);

    document
        .getElementById("intro-view")
        .classList.add("hidden");

    const ev = document.getElementById("endpoint-view");

    ev.classList.remove("hidden");
    ev.classList.add("flex");

    closeSidebar();
    scrollToEndpointView();

    try { history.replaceState(null, "", "#ep=" + encodeURIComponent(id)); } catch (e) {}
}

/*
 * FIX: sebelum ini, begitu endpoint dipilih dari sidebar, form
 * endpoint langsung ditampilkan tapi posisi scroll halaman TIDAK
 * ikut berpindah. Di layar sempit (mobile/tablet) kartu terminal +
 * info (waktu/baterai/device) itu satu kolom penuh yang ditumpuk DI
 * ATAS form endpoint (grid 2 kolom cuma aktif di breakpoint `lg`),
 * jadi orang yang baru pilih endpoint tetap melihat terminal seperti
 * semula dan harus geser manual ke bawah untuk sadar formnya sudah
 * muncul - banyak yang tidak tahu harus geser. Sekarang begitu
 * endpoint dipilih, halaman otomatis di-scroll ke form itu, dengan
 * jarak dari atas layar (SCROLL_OFFSET) supaya form tidak ketutupan
 * header sticky di bagian atas.
 */
const SCROLL_OFFSET = 96;

function scrollToEndpointView() {
    requestAnimationFrame(() => {
        const ev = document.getElementById("endpoint-view");

        if (!ev) return;

        const top = ev.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;

        window.scrollTo({ top, behavior: "smooth" });
    });
}

window.backToIntro = () => {
    const ev = document.getElementById("endpoint-view");

    ev.classList.add("hidden");
    ev.classList.remove("flex");
    ev.innerHTML = "";

    document
        .getElementById("intro-view")
        .classList.remove("hidden");

    document.querySelectorAll(".file-item").forEach(file => {
        file.classList.remove("active");
    });

    document
        .getElementById("sidebar-intro-btn")
        .classList.add("active");

    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    window.scrollTo({ top: 0, behavior: "smooth" });
};

function renderEndpointCard(route, id) {
    const ev = document.getElementById("endpoint-view");

    let copyUrl = route.endpoint;

    if (
        route.method === "GET" &&
        route.params &&
        route.params.length > 0
    ) {
        copyUrl =
            `${route.endpoint}?` +
            route.params
                .map(param => `${param.name}=`)
                .join("&");
    }

    let inputs = "";

    if (route.params?.length) {
        inputs = `
            <div class="grid gap-3 px-4 sm:px-[18px] pb-5">
                ${route.params
                    .map(
                        param => `
                            <div>
                                <label
                                    class="text-[11px] font-bold mb-1.5 block"
                                    style="color:#2B2B2B"
                                >
                                    ${param.name}
                                    ${
                                        param.required
                                            ? '<span style="color:#DC2626">*</span>'
                                            : ""
                                    }
                                </label>

                                <input
                                    type="text"
                                    id="input-${id}-${param.name}"
                                    placeholder="${
                                        param.description ||
                                        "Masukkan nilai..."
                                    }"
                                    class="clay-input" inputmode="text" autocomplete="off" autocapitalize="off"
                                >
                            </div>
                        `
                    )
                    .join("")}
            </div>
        `;
    }

    const methodClass =
        route.method === "GET"
            ? "get"
            : route.method === "POST"
                ? "post"
                : route.method === "DELETE"
                    ? "delete"
                    : "other";

    const stripe = { get: "#93C5FD", post: "#4ADE80", delete: "#FCA5A5", other: "#FDE047" }[methodClass];
    const origin = window.location.origin;
    const paramList = route.params || [];
    const reqCount = paramList.filter(p => p.required).length;

    const curlParams = paramList.map(p => p.name);
    const curlSnippet = route.method === "GET"
        ? `curl -X GET "${origin}${route.endpoint}${curlParams.length ? "?" + curlParams.map(n => `${n}=VALUE`).join("&") : ""}"`
        : `curl -X ${route.method} "${origin}${route.endpoint}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(Object.fromEntries(curlParams.map(n => [n, "VALUE"])))}'`;
    const jsSnippet = route.method === "GET"
        ? `const res = await fetch("${origin}${route.endpoint}${curlParams.length ? "?" + curlParams.map(n => `${n}=VALUE`).join("&") : ""}");\nconst data = await res.json();\nconsole.log(data);`
        : `const res = await fetch("${origin}${route.endpoint}", {\n  method: "${route.method}",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(Object.fromEntries(curlParams.map(n => [n, "VALUE"])))})\n});\nconst data = await res.json();\nconsole.log(data);`;

    ev.innerHTML = `
        <div class="flex flex-wrap items-center gap-3">
            <button class="back-btn w-fit" onclick="backToIntro()">
                <i class="fa-solid fa-arrow-left"></i>
                Semua Endpoint
            </button>

            <button class="back-btn w-fit" style="background:#fff" onclick="copyLink('${id}')" title="Salin link endpoint ini">
                <i class="fa-solid fa-link"></i>
                <span class="hidden sm:inline">Salin Link</span>
            </button>
        </div>

        <div class="ep-card reveal in ep-enter">
            <div style="height:10px;background:${stripe};border-bottom:3px solid #0A0A0A"></div>

            <div class="ep-head">
                <span class="method-badge ${methodClass}">${escHtml(route.method)}</span>

                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-black text-base leading-tight break-words" style="color:#0A0A0A">${escHtml(route.name)}</span>

                    <div class="ep-meta">
                        <span class="ep-tag cat"><i class="fa-solid ${catIcon(route.cat)} text-[10px]"></i>${escHtml(route.cat)}</span>
                        <span class="ep-tag">${paramList.length} parameter</span>
                        ${reqCount ? `<span class="ep-tag req">${reqCount} wajib</span>` : ""}
                    </div>

                    <code class="ep-url font-mono">${escHtml(route.endpoint)}</code>
                </div>
            </div>

            ${inputs}

            <details class="ep-section">
                <summary><i class="fa-solid fa-code text-xs"></i> Contoh kode</summary>
                <div class="code-wrap">
                    <span class="code-lang-label">cURL</span>
                    <button type="button" class="code-copy" onclick="copyBlock('curl-${id}', this)"><i class="fa-regular fa-copy"></i> Salin</button>
                    <div class="intro-code" id="curl-${id}"></div>
                </div>
                <div class="code-wrap">
                    <span class="code-lang-label">JavaScript</span>
                    <button type="button" class="code-copy" onclick="copyBlock('js-${id}', this)"><i class="fa-regular fa-copy"></i> Salin</button>
                    <div class="intro-code" id="js-${id}"></div>
                </div>
            </details>

            <div class="exec-bar">
                <button
                    id="btn-exec-${id}"
                    onclick="testReq(this,'${route.endpoint}','${route.method}','${id}')"
                    class="clay-btn tracking-wide"
                >
                    <i class="fa-solid fa-play text-xs"></i>
                    EXECUTE
                </button>

                <button onclick="copy('${copyUrl}')" class="clay-icon-btn" title="Copy URL" aria-label="Salin URL">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>

            <div id="res-area-${id}" class="hidden res-area-wrap clay-console-screen">
                <div class="flex justify-between items-center px-4 py-2.5 border-b border-white/10">
                    <div class="flex items-center gap-2">
                        <span id="status-dot-${id}" class="status-dot status-waiting"></span>
                        <span id="status-${id}" class="text-slate-400 font-bold font-mono text-[10px]">WAITING</span>
                    </div>

                    <span id="time-${id}" class="text-slate-500 font-mono text-[10px]">--ms</span>
                </div>

                <div class="flex justify-end gap-4 px-4 pt-2">
                    <a id="dl-btn-${id}" class="hidden text-emerald-400 text-sm" aria-label="Unduh"><i class="fa-solid fa-download"></i></a>
                    <button onclick="copyRes('${id}')" class="text-sky-400 text-sm" aria-label="Salin respons"><i class="fa-regular fa-clone"></i></button>
                    <button onclick="reset('${id}')" class="text-rose-400 text-sm" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <div
                    id="output-${id}"
                    class="font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all max-h-[320px] overflow-y-auto p-4 text-slate-300 leading-relaxed"
                ></div>
            </div>
        </div>
    `;

    const curlEl = document.getElementById(`curl-${id}`);
    const jsEl = document.getElementById(`js-${id}`);
    if (curlEl) curlEl.textContent = curlSnippet;
    if (jsEl) jsEl.textContent = jsSnippet;
}

function setupSidebarEvents() {
    document
        .getElementById("menu-toggle")
        .addEventListener("click", openSidebar);

    document
        .getElementById("sidebar-close")
        .addEventListener("click", closeSidebar);

    document
        .getElementById("sidebar-overlay")
        .addEventListener("click", closeSidebar);

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeSidebar();
    });
}

function openSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document
        .getElementById("sidebar-overlay")
        .classList.add("show");

    document
        .getElementById("menu-toggle")
        .setAttribute("aria-expanded", "true");

    document
        .getElementById("sidebar")
        .setAttribute("aria-hidden", "false");

    document.documentElement.classList.add("kb-lock");

    requestAnimationFrame(() => {
        const tree = document.getElementById("sidebar-tree");
        if (!tree) return;
        const active = tree.querySelector(".file-item.active");
        if (active) active.scrollIntoView({ block: "center" });
        else tree.scrollTop = 0;
    });
}

function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document
        .getElementById("sidebar-overlay")
        .classList.remove("show");

    document
        .getElementById("menu-toggle")
        .setAttribute("aria-expanded", "false");

    document
        .getElementById("sidebar")
        .setAttribute("aria-hidden", "true");

    document.documentElement.classList.remove("kb-lock");
}

function setSearch() {
    const input = document.getElementById("search-input");

    if (!input) return;

    input.addEventListener("input", applyFilter);
}

window.copy = text => {
    navigator.clipboard.writeText(
        window.location.origin + text
    );

    messeg("ENDPOINT COPIED");
    terminalLog(`Copied URL: ${text}`);
};

window.copyRes = id => {
    const out = document.getElementById(`output-${id}`);

    if (!out.innerText) return;

    navigator.clipboard.writeText(out.innerText);
    messeg("RESPONSE COPIED");
};

window.reset = id => {
    document
        .getElementById(`res-area-${id}`)
        .classList.add("hidden");

    document.getElementById(`output-${id}`).innerHTML = "";

    const dlBtn = document.getElementById(`dl-btn-${id}`);

    if (dlBtn) {
        dlBtn.classList.add("hidden");
    }

    document
        .querySelectorAll(`[id^="input-${id}-"]`)
        .forEach(input => {
            input.value = "";
        });

    document.getElementById(`status-dot-${id}`).className =
        "status-dot status-waiting";

    document.getElementById(`status-${id}`).innerText =
        "WAITING";

    document.getElementById(`time-${id}`).innerText =
        "--ms";
};

window.testReq = async (btn, url, method, id) => {
    if (btn.disabled) return;

    const out = document.getElementById(`output-${id}`);
    const status = document.getElementById(`status-${id}`);
    const statusDot = document.getElementById(`status-dot-${id}`);
    const time = document.getElementById(`time-${id}`);
    const dlBtn = document.getElementById(`dl-btn-${id}`);
    const originalBtnText = btn.innerHTML;

    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = `
        <i class="fa-solid fa-circle-notch"></i>
        <span>RUNNING</span>
    `;

    document
        .getElementById(`res-area-${id}`)
        .classList.remove("hidden");

    if (dlBtn) {
        dlBtn.classList.add("hidden");
        dlBtn.href = "#";
    }

    status.innerText = "PROCESSING...";
    statusDot.className = "status-dot status-waiting";

    out.innerHTML = `
        <span class="text-slate-500 italic">
            establishing connection...
        </span>
    `;

    const params = {};

    document
        .querySelectorAll(`[id^="input-${id}-"]`)
        .forEach(input => {
            if (input.value) {
                params[
                    input.id.split(`input-${id}-`)[1]
                ] = input.value;
            }
        });

    const fetchUrl =
        url +
        (
            method === "GET" &&
            Object.keys(params).length
                ? "?" + new URLSearchParams(params)
                : ""
        );

    const opts = { method };

    if (method !== "GET") {
        opts.headers = {
            "Content-Type": "application/json"
        };

        opts.body = JSON.stringify(params);
    }

    const fullUrl = fetchUrl.startsWith("http")
        ? fetchUrl
        : window.location.origin + fetchUrl;

    const startTime = Date.now();

    const timerInterval = setInterval(() => {
        time.innerText = `${Date.now() - startTime}ms`;
    }, 75);

    try {
        const req = await fetch(fetchUrl, opts);

        clearInterval(timerInterval);

        const duration = Date.now() - startTime;

        status.innerText =
            `${req.status} ${req.statusText}`;

        statusDot.className = req.ok
            ? "status-dot status-success"
            : "status-dot status-error";

        time.innerText = `${duration}ms`;

        terminalLog(
            `[ ${req.status} ] ${method} ${fullUrl} (${duration}ms)`,
            req.ok ? "success" : "error"
        );

        const type = req.headers.get("content-type");

        if (type?.includes("json")) {
            const json = await req.json();
            out.innerHTML = syntaxHighlight(json);
        } else if (type?.startsWith("image")) {
            const blob = await req.blob();
            const urlObj = URL.createObjectURL(blob);

            if (dlBtn) {
                dlBtn.href = urlObj;
                dlBtn.download = `img-${Date.now()}.jpg`;
                dlBtn.classList.remove("hidden");
            }

            out.innerHTML = `
                <div class="flex justify-center p-2">
                    <img
                        src="${urlObj}"
                        class="max-w-full rounded-xl max-h-[280px]"
                    >
                </div>
            `;
        } else {
            out.innerText = await req.text();
        }
    } catch (err) {
        clearInterval(timerInterval);

        out.innerHTML = `
            <span class="text-rose-400 font-bold">
                CONNECTION_REFUSED
            </span>
            <br>
            <span class="text-slate-500">
                ${err.message}
            </span>
        `;

        status.innerText = "ERR";
        statusDot.className = "status-dot status-error";

        terminalLog(
            `Fetch Failed: ${err.message}`,
            "error"
        );
    } finally {
        btn.disabled = false;
        btn.classList.remove("loading");
        btn.innerHTML = originalBtnText;

        const area = document.getElementById(`res-area-${id}`);
        if (area) area.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
};

function syntaxHighlight(json) {
    if (typeof json !== "string") {
        json = JSON.stringify(json, undefined, 2);
    }

    return json
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(
            /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
            match => {
                let cls = "json-number";
                if (/^"/.test(match)) {
                    cls = /:$/.test(match)
                        ? "json-key"
                        : "json-string";
                } else if (/true|false/.test(match)) {
                    cls = "json-boolean";
                } else if (/null/.test(match)) {
                    cls = "json-null";
                }
                return `<span class="${cls}">${match}</span>`;
            }
        );
}