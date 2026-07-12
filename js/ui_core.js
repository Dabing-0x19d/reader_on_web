window.HRUi = (function() {
    const state = {
        currentView: "library",        // 'library' (书库/收藏/历史) 或 'reading' (当前阅读)
        currentCategory: "all",        // 书库分类 (all, classics, modern, local)
        currentKeyword: "",            // 搜索关键字
        currentBookId: null,
        currentBook: null,             // 当前解析后的完整图书对象
        currentChapterIdx: 0,
        readingTimeSec: 0,             // 本次阅读时长(秒)
        timeInterval: null,
        nextChapterTimeout: null,      // 滚动下一章延时定时器
        isTransitioning: false         // 是否正在加载下一章
    };

    // DOM 根节点缓存
    function root() {
        return {
            tabsEl: document.getElementById("categoryTabs"),
            listEl: document.getElementById("itemList"),
            searchEl: document.getElementById("searchInput"),
            contentFrame: document.getElementById("readerContentFrame"),
            placeholderEl: document.getElementById("readerPlaceholder"),
            statusDot: document.getElementById("statusDot"),
            statusText: document.getElementById("statusText"),
            percentageEl: document.getElementById("readerPercentage"),
            formatBadge: document.getElementById("bookFormatBadge"),
            notesTimeline: document.getElementById("notesTimeline"),
            btnClearNotes: document.getElementById("btnClearNotes"),
            
            // 统计指标
            statWords: document.getElementById("statWordCount"),
            statChapterWords: document.getElementById("statChapterWordCount"),
            statReadTime: document.getElementById("statReadTime"),

            // 字体控制
            btnFontSerif: document.getElementById("btnFontSerif"),
            btnFontSans: document.getElementById("btnFontSans"),
            btnDecFont: document.getElementById("btnDecFont"),
            btnIncFont: document.getElementById("btnIncFont"),
            btnAddBookmark: document.getElementById("btnAddBookmark"),
            btnFullscreen: document.getElementById("btnFullscreen"),
            btnDecWidth: document.getElementById("btnDecWidth"),
            btnIncWidth: document.getElementById("btnIncWidth"),
            ctrlFullscreenWidth: document.getElementById("ctrlFullscreenWidth"),
            bottomPrompt: document.getElementById("readerBottomPrompt"),
            bottomPromptText: document.getElementById("bottomPromptText")
        };
    }

    // 吐司通知
    function showToast(msg, type = "success") {
        const container = document.getElementById("toastContainer");
        if (!container) return;
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        
        let icon = "✓";
        if (type === "error") icon = "✗";
        if (type === "info") icon = "ℹ";
        
        el.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
        container.appendChild(el);
        
        setTimeout(() => el.remove(), 3000);
    }

    // 安全的 HTML 字符串逃逸
    function escapeHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[ch]));
    }

    // 视图切换 (图书库 与 当前阅读 切换)
    function switchView(view) {
        const navItems = document.querySelectorAll(".sidebar .nav-links .nav-item");
        navItems.forEach(item => {
            if (item.dataset.view === view) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });

        state.currentView = view;
        state.currentCategory = "all"; // 归零
        window.HRUi.renderTabs();
        window.HRUi.renderList();
    }

    // 装载书库数据并渲染
    function setLibraryView() {
        state.currentView = "library";
        window.HRUi.renderTabs();
        window.HRUi.renderList();
    }

    // 导航项绑定切换
    function bindNav() {
        document.querySelectorAll(".sidebar .nav-links .nav-item").forEach(item => {
            item.addEventListener("click", () => {
                const targetView = item.dataset.view;
                if (targetView === "reading" && !state.currentBook) {
                    showToast("请先选择一本图书载入阅读", "info");
                    return;
                }
                
                // 设置相应的 categoryTab 属性
                if (targetView === "library") state.currentCategory = "all";
                else if (targetView === "favorites") state.currentCategory = "fav";
                else if (targetView === "history") state.currentCategory = "history";
                
                if (targetView === "reading") {
                    state.currentView = "reading";
                    window.HRUi.renderTabs();
                    window.HRUi.renderList();
                } else {
                    state.currentView = "library";
                    window.HRUi.renderTabs();
                    window.HRUi.renderList();
                }

                // 移除其他激活，突出自身
                document.querySelectorAll(".sidebar .nav-links .nav-item").forEach(i => i.classList.remove("active"));
                item.classList.add("active");
            });
        });
    }

    function init() {
        const r = root();
        
        // 绑定搜索框
        r.searchEl.addEventListener("input", (e) => {
            state.currentKeyword = e.target.value.trim();
            window.HRUi.renderList();
        });

        // 绑定设置按钮
        r.btnFontSerif.addEventListener("click", () => window.HRUi.setFontFamily("serif"));
        r.btnFontSans.addEventListener("click", () => window.HRUi.setFontFamily("sans-serif"));
        r.btnDecFont.addEventListener("click", () => window.HRUi.adjustFontSize(-2));
        r.btnIncFont.addEventListener("click", () => window.HRUi.adjustFontSize(2));
        
        // 绑定全屏宽度设置按钮
        if (r.btnDecWidth) {
            r.btnDecWidth.addEventListener("click", () => window.HRUi.adjustReaderWidth(-5));
        }
        if (r.btnIncWidth) {
            r.btnIncWidth.addEventListener("click", () => window.HRUi.adjustReaderWidth(5));
        }
        
        r.btnAddBookmark.addEventListener("click", () => window.HRUi.addBookmarkAction());
        
        // 清空书签
        r.btnClearNotes.addEventListener("click", () => window.HRUi.clearCurrentNotes());

        // 监听阅读框架的滚动，实时计算进度百分比
        r.contentFrame.addEventListener("scroll", () => window.HRUi.updateScrollPercentage());

        // 绑定全屏控制
        if (r.btnFullscreen) {
            r.btnFullscreen.addEventListener("click", () => window.HRUi.toggleFullscreen());
        }
        document.addEventListener("fullscreenchange", () => window.HRUi.handleFullscreenChange());

        // 绑定全屏专属目录展开并居中定位当前激活项
        const btnFSToc = document.getElementById("btnFullscreenTocToggle");
        const panelFSToc = document.getElementById("readerFullscreenTocPanel");
        if (btnFSToc && panelFSToc) {
            btnFSToc.addEventListener("click", (e) => {
                e.stopPropagation();
                const isShowing = panelFSToc.classList.toggle("show");
                if (isShowing) {
                    // 让当前激活的章节滚动到面板中间
                    setTimeout(() => {
                        const activeItem = panelFSToc.querySelector(".fs-toc-item.active");
                        const fsTocBody = document.getElementById("fsTocBody");
                        if (activeItem && fsTocBody) {
                            const bodyHeight = fsTocBody.clientHeight;
                            const itemTop = activeItem.offsetTop;
                            const itemHeight = activeItem.clientHeight;
                            fsTocBody.scrollTop = itemTop - (bodyHeight / 2) + (itemHeight / 2);
                        }
                    }, 350);
                }
            });
            // 点击外部（正文）自动关闭全屏目录
            r.contentFrame.addEventListener("click", () => {
                panelFSToc.classList.remove("show");
            });
        }

        // 启动阅读计时器
        window.HRUi.startReadTimer();
    }

    return {
        state,
        root,
        init,
        showToast,
        escapeHtml,
        switchView,
        setLibraryView,
        bindNav
    };
})();
