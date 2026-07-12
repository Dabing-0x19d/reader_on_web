(function(ui) {
    // 核心阅读渲染引擎
    ui.openBook = async function(bookId, chapterIdx = 0, scrollPercent = 0) {
        const book = await window.HRStorage.loadBook(bookId);
        if (!book) throw new Error("图书未找到");

        ui.state.currentBookId = bookId;
        ui.state.currentBook = book;
        ui.state.currentChapterIdx = Math.min(Math.max(0, chapterIdx), book.chapters.length - 1);

        const r = ui.root();
        
        // 隐藏遮罩层
        r.placeholderEl.classList.add("is-hidden");
        
        const chapter = book.chapters[ui.state.currentChapterIdx];

        // 更新顶条和控制项
        r.statusDot.classList.remove("is-idle");
        r.statusText.textContent = `《${book.title}》 · ${chapter ? chapter.title : ""}`;
        r.formatBadge.textContent = book.format.toUpperCase();

        // 渲染正文
        if (chapter) {
            r.contentFrame.innerHTML = `
                <h2>${ui.escapeHtml(chapter.title)}</h2>
                <div>${chapter.content}</div>
            `;
            // 重置滚动到最上方或指定百分比
            r.contentFrame.scrollTop = 0;
            if (scrollPercent > 0) {
                setTimeout(() => {
                    const scrollHeight = r.contentFrame.scrollHeight - r.contentFrame.clientHeight;
                    r.contentFrame.scrollTop = scrollHeight * (scrollPercent / 100);
                }, 100);
            }
        } else {
            r.contentFrame.innerHTML = `<h2>未发现内容</h2>`;
        }

        // 应用排版配置
        ui.applyReadingSettings();

        // 写入阅读历史和状态
        const state = window.HRStorage.readState();
        state.currentBookId = bookId;
        state.currentChapterIdx = ui.state.currentChapterIdx;
        state.currentScrollPercent = scrollPercent;
        window.HRStorage.writeState(state);
        window.HRStorage.pushHistory(bookId, book.title, book.author, ui.state.currentChapterIdx, scrollPercent);

        // 更新统计数据
        ui.updateStats();

        // 渲染下方划线与书签面板
        ui.renderBottomNotes();

        // 渲染全屏专属目录列表
        ui.renderFullscreenToc();
    };

    // 章节跳转
    ui.jumpToChapter = async function(idx, percent = 0) {
        if (!ui.state.currentBook) return;
        await ui.openBook(ui.state.currentBookId, idx, percent);
        // 如果侧边栏处于阅读视图，更新目录/书签的 active 态
        const activeTab = document.querySelector(".category-tabs .category-tab.active");
        if (activeTab) {
            ui.renderReadingList(activeTab.dataset.readtab);
        }
    };

    // 选择并打开一本书
    ui.selectAndOpenBook = async function(bookId) {
        try {
            const state = window.HRStorage.readState();
            let chapterIdx = 0;
            let percent = 0;

            if (state.currentBookId === bookId) {
                chapterIdx = state.currentChapterIdx || 0;
                percent = state.currentScrollPercent || 0;
            } else {
                const hist = state.history.find(h => h.bookId === bookId);
                if (hist) {
                    chapterIdx = hist.chapterIdx || 0;
                    percent = hist.percent || 0;
                }
            }

            await ui.openBook(bookId, chapterIdx, percent);
            ui.switchView("reading");
        } catch (e) {
            console.error("[ui] Error opening book:", e);
            ui.showToast("打开图书失败：" + e.message, "error");
        }
    };

    // 应用字体/字号/行距等排版设置
    ui.applyReadingSettings = function() {
        const state = window.HRStorage.readState();
        const { contentFrame, btnFontSerif, btnFontSans } = ui.root();

        // 字体
        if (state.settings.fontFamily === "serif") {
            contentFrame.className = "reader-content-frame font-serif";
            btnFontSerif.classList.add("active");
            btnFontSans.classList.remove("active");
        } else {
            contentFrame.className = "reader-content-frame font-sans-serif";
            btnFontSerif.classList.remove("active");
            btnFontSans.classList.add("active");
        }

        // 字号和行高
        contentFrame.style.fontSize = `${state.settings.fontSize}px`;
        contentFrame.style.lineHeight = `${state.settings.lineFactor}`;

        // 全屏宽度适配
        const container = document.querySelector(".reader-container");
        if (container) {
            container.style.setProperty("--reader-width", `${state.settings.readerWidth || 80}%`);
        }

        // 默认为滚动模式，隐藏翻页热区
        contentFrame.style.overflowY = "auto";
        const pageLeft = document.getElementById("pageNavLeft");
        const pageRight = document.getElementById("pageNavRight");
        if (pageLeft) pageLeft.style.display = "none";
        if (pageRight) pageRight.style.display = "none";
    };

    // 切换排版字体
    ui.setFontFamily = function(family) {
        const state = window.HRStorage.readState();
        state.settings.fontFamily = family;
        window.HRStorage.writeState(state);
        ui.applyReadingSettings();
    };

    // 调整字号大小
    ui.adjustFontSize = function(delta) {
        const state = window.HRStorage.readState();
        let size = (state.settings.fontSize || 18) + delta;
        size = Math.min(Math.max(12, size), 32);
        state.settings.fontSize = size;
        window.HRStorage.writeState(state);
        ui.applyReadingSettings();
    };

    // 调节全屏下的版面宽度
    ui.adjustReaderWidth = function(delta) {
        const state = window.HRStorage.readState();
        let width = (state.settings.readerWidth || 80) + delta;
        width = Math.min(Math.max(50, width), 95);
        state.settings.readerWidth = width;
        window.HRStorage.writeState(state);
        ui.applyReadingSettings();
        ui.showToast(`全屏版面宽度已调整为：${width}%`);
    };

    // 全屏模式切换
    ui.toggleFullscreen = function() {
        const container = document.querySelector(".reader-container");
        if (!container) return;

        if (!document.fullscreenElement) {
            container.requestFullscreen().then(() => {
                ui.showToast("已进入全屏阅读模式");
            }).catch(err => {
                console.warn("[ui] Fullscreen error:", err);
                ui.showToast("浏览器不支持或拒绝全屏", "error");
            });
        } else {
            document.exitFullscreen().then(() => {
                ui.showToast("已退出全屏模式");
            });
        }
    };

    // 全屏状态改变监听
    ui.handleFullscreenChange = function() {
        const btn = document.getElementById("btnFullscreen");
        const ctrlWidth = document.getElementById("ctrlFullscreenWidth");
        const panelFSToc = document.getElementById("readerFullscreenTocPanel");
        if (document.fullscreenElement) {
            if (btn) {
                btn.textContent = "退出";
                btn.title = "退出全屏";
            }
            if (ctrlWidth) ctrlWidth.style.display = "flex";
        } else {
            if (btn) {
                btn.textContent = "全屏";
                btn.title = "网页全屏";
            }
            if (ctrlWidth) ctrlWidth.style.display = "none";
            if (panelFSToc) panelFSToc.classList.remove("show");
        }
    };

    // 监听正文滚动，实时更新百分比和存盘进度
    ui.updateScrollPercentage = function() {
        const { contentFrame, percentageEl } = ui.root();
        const scrollTop = contentFrame.scrollTop;
        const scrollHeight = contentFrame.scrollHeight - contentFrame.clientHeight;
        
        let percent = 0;
        if (scrollHeight > 0) {
            percent = (scrollTop / scrollHeight) * 100;
        }

        // 计算全书整体进度
        let overallPercent = 0;
        if (ui.state.currentBook && ui.state.currentBook.chapters.length > 0) {
            const totalChapters = ui.state.currentBook.chapters.length;
            overallPercent = ((ui.state.currentChapterIdx + percent / 100) / totalChapters) * 100;
            overallPercent = Math.min(Math.max(0, overallPercent), 100);
        }

        percentageEl.textContent = `全书 ${overallPercent.toFixed(1)}%`;

        // 节流写入进度 state
        if (ui.state.currentBookId) {
            const state = window.HRStorage.readState();
            state.currentScrollPercent = percent;
            window.HRStorage.writeState(state);
            
            // 同步更新历史列表进度
            const hist = state.history.find(h => h.bookId === ui.state.currentBookId);
            if (hist) {
                hist.chapterIdx = ui.state.currentChapterIdx;
                hist.percent = Math.round(percent);
                window.HRStorage.writeState(state);
            }
        }

        // 检测是否滚动到底部以自动跳转下一章
        if (scrollHeight > 0 && scrollTop >= scrollHeight - 3) {
            ui.triggerNextChapterDebounced();
        } else if (ui.state.nextChapterTimeout && scrollTop < scrollHeight - 30) {
            // 如果用户向上滚动，取消即将跳转的定时器并隐藏底部提示
            clearTimeout(ui.state.nextChapterTimeout);
            ui.state.nextChapterTimeout = null;
            ui.state.isTransitioning = false;
            
            const { bottomPrompt } = ui.root();
            if (bottomPrompt) {
                bottomPrompt.classList.remove("show");
            }
        }
    };

    // 自动加载下一章的延时防抖逻辑
    ui.triggerNextChapterDebounced = function() {
        if (ui.state.isTransitioning) return;
        if (!ui.state.currentBook || ui.state.currentChapterIdx >= ui.state.currentBook.chapters.length - 1) return;

        const nextChapter = ui.state.currentBook.chapters[ui.state.currentChapterIdx + 1];
        if (!nextChapter) return;

        if (ui.state.nextChapterTimeout) return;

        const { bottomPrompt, bottomPromptText } = ui.root();
        if (bottomPrompt && bottomPromptText) {
            bottomPromptText.textContent = `即将阅读下一节：${nextChapter.title}...`;
            bottomPrompt.classList.add("show");
        }
        ui.state.isTransitioning = true;

        ui.state.nextChapterTimeout = setTimeout(() => {
            const { contentFrame, bottomPrompt: bPrompt } = ui.root();
            const scrollTop = contentFrame.scrollTop;
            const scrollHeight = contentFrame.scrollHeight - contentFrame.clientHeight;

            if (bPrompt) {
                bPrompt.classList.remove("show");
            }

            // 再次验证用户是否仍在底部，防误触
            if (scrollTop >= scrollHeight - 15) {
                ui.jumpToChapter(ui.state.currentChapterIdx + 1, 0);
                ui.showToast(`已载入下一节：${nextChapter.title}`);
            } else {
                console.log("[ui] 用户已离开底部，取消跳转");
            }
            ui.state.nextChapterTimeout = null;
            ui.state.isTransitioning = false;
        }, 1200);
    };

})(window.HRUi);
