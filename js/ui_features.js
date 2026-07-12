(function(ui) {
    // 渲染下方面板的书签笔记列表
    ui.renderBottomNotes = function() {
        const { notesTimeline, btnClearNotes } = ui.root();
        if (!ui.state.currentBook) {
            notesTimeline.innerHTML = `<div class="notes-empty">选择图书后即可查看书签与划线</div>`;
            btnClearNotes.style.display = "none";
            return;
        }

        const state = window.HRStorage.readState();
        const bookBookmarks = (state.bookmarks || []).filter(b => b.bookId === ui.state.currentBookId);

        if (bookBookmarks.length === 0) {
            notesTimeline.innerHTML = `<div class="notes-empty">本章节尚无记录，点击右上角“添加书签”来记录位置或划线金句。</div>`;
            btnClearNotes.style.display = "none";
            return;
        }

        btnClearNotes.style.display = "inline";

        const sorted = [...bookBookmarks].sort((a, b) => b.at - a.at);
        notesTimeline.innerHTML = sorted.map(b => {
            const tag = b.selectedText ? "划线笔记" : "进度书签";
            const text = b.selectedText ? `“${b.selectedText}”` : `${b.chapterTitle} (${b.percent}%)`;
            return `
                <div class="note-item" data-idx="${b.chapterIdx}" data-percent="${b.percent}">
                    <span class="note-tag">[${tag}]</span>
                    <span class="note-text">${ui.escapeHtml(text)}</span>
                </div>
            `;
        }).join("");

        notesTimeline.querySelectorAll(".note-item").forEach(el => {
            el.addEventListener("click", () => {
                const idx = parseInt(el.dataset.idx, 10);
                const percent = parseFloat(el.dataset.percent);
                ui.jumpToChapter(idx, percent);
            });
        });
    };

    // 书签与高亮操作
    ui.addBookmarkAction = function() {
        if (!ui.state.currentBook) {
            ui.showToast("请先选择一本图书开始阅读", "error");
            return;
        }

        const state = window.HRStorage.readState();
        if (!state.bookmarks) state.bookmarks = [];

        const selection = window.getSelection().toString().trim();
        const percentVal = parseFloat(ui.root().percentageEl.textContent.replace(/[^\d.]/g, "")) || 0;
        const percent = Math.round(percentVal);
        const chapterTitle = ui.state.currentBook.chapters[ui.state.currentChapterIdx].title;

        const bookmark = {
            id: "bookmark-" + Date.now().toString(36),
            bookId: ui.state.currentBookId,
            chapterIdx: ui.state.currentChapterIdx,
            chapterTitle: chapterTitle,
            percent: percent,
            selectedText: selection.substring(0, 150),
            at: Date.now()
        };

        state.bookmarks.push(bookmark);
        window.HRStorage.writeState(state);

        if (selection) {
            ui.showToast("已成功划线并记录金句笔记！");
        } else {
            ui.showToast("书签添加成功！已保存当前阅读进度位置。");
        }

        ui.renderBottomNotes();
        const activeTab = document.querySelector(".category-tabs .category-tab.active");
        if (activeTab && activeTab.dataset.readtab === "bookmarks") {
            ui.renderReadingList("bookmarks");
        }
    };

    // 删除书签
    ui.deleteBookmark = function(bId) {
        const state = window.HRStorage.readState();
        state.bookmarks = (state.bookmarks || []).filter(b => b.id !== bId);
        window.HRStorage.writeState(state);
        ui.showToast("已删除该书签");
        ui.renderBottomNotes();
        ui.renderReadingList("bookmarks");
    };

    // 清空当前图书的书签
    ui.clearCurrentNotes = function() {
        if (!confirm("确定要清空本图书的所有书签和划线记录吗？")) return;
        const state = window.HRStorage.readState();
        state.bookmarks = (state.bookmarks || []).filter(b => b.bookId !== ui.state.currentBookId);
        window.HRStorage.writeState(state);
        ui.showToast("书签已清空");
        ui.renderBottomNotes();
        ui.renderReadingList("bookmarks");
    };

    // 阅读统计功能面板更新
    ui.updateStats = function() {
        const r = ui.root();
        if (!ui.state.currentBook) return;

        // 计算全书字数
        let totalWords = 0;
        ui.state.currentBook.chapters.forEach(c => {
            totalWords += (c.content || "").replace(/<[^>]*>/g, "").trim().length;
        });
        r.statWords.textContent = `${(totalWords / 10000).toFixed(2)} 万字`;

        // 当前章节字数
        const chapContent = ui.state.currentBook.chapters[ui.state.currentChapterIdx]?.content || "";
        const chapWords = chapContent.replace(/<[^>]*>/g, "").trim().length;
        r.statChapterWords.textContent = `${chapWords} 字`;

        // 渲染本次阅读计时器
        r.statReadTime.textContent = `${Math.floor(ui.state.readingTimeSec / 60)} 分钟`;
    };

    // 启动阅读计时
    ui.startReadTimer = function() {
        if (ui.state.timeInterval) clearInterval(ui.state.timeInterval);
        ui.state.timeInterval = setInterval(() => {
            if (ui.state.currentView === "reading" && ui.state.currentBook) {
                ui.state.readingTimeSec++;
                if (ui.state.readingTimeSec % 60 === 0) {
                    const r = ui.root();
                    r.statReadTime.textContent = `${Math.floor(ui.state.readingTimeSec / 60)} 分钟`;
                }
            }
        }, 1000);
    };

    // 渲染全屏专属目录列表
    ui.renderFullscreenToc = function() {
        const fsTocBody = document.getElementById("fsTocBody");
        if (!fsTocBody || !ui.state.currentBook) return;

        fsTocBody.innerHTML = ui.state.currentBook.chapters.map((c, i) => {
            const isActive = ui.state.currentChapterIdx === i;
            return `
                <div class="fs-toc-item ${isActive ? "active" : ""}" data-idx="${i}">
                    <span class="fs-toc-item-title">${ui.escapeHtml(c.title)}</span>
                </div>
            `;
        }).join("");

        fsTocBody.querySelectorAll(".fs-toc-item").forEach(el => {
            el.addEventListener("click", () => {
                const idx = parseInt(el.dataset.idx, 10);
                ui.jumpToChapter(idx);
                
                // 点击后自动收起全屏目录
                const panel = document.getElementById("readerFullscreenTocPanel");
                if (panel) panel.classList.remove("show");
            });
        });
    };

})(window.HRUi);
